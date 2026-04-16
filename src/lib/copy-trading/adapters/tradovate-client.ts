import type { TradovateCredentials, TradovateTokenResponse } from '@/types/copy-trading';

// ws is loaded dynamically to avoid build failures when the package isn't installed yet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let WebSocket: any;

const DEMO_URL = 'https://demo.tradovateapi.com/v1';
const LIVE_URL = 'https://live.tradovateapi.com/v1';
const DEMO_WS = 'wss://demo.tradovateapi.com/v1/websocket';
const LIVE_WS = 'wss://live.tradovateapi.com/v1/websocket';
const MD_WS = 'wss://md.tradovateapi.com/v1/websocket';

export class TradovateClient {
  private accessToken: string | null = null;
  private mdAccessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private userId: number = 0;
  private baseUrl: string;
  private wsUrl: string;
  private credentials: TradovateCredentials;
  private ws: WebSocket | null = null;
  private requestId = 1;
  private pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private entityListeners = new Map<string, ((data: any) => void)[]>();

  constructor(credentials: TradovateCredentials) {
    this.credentials = credentials;
    this.baseUrl = credentials.environment === 'live' ? LIVE_URL : DEMO_URL;
    this.wsUrl = credentials.environment === 'live' ? LIVE_WS : DEMO_WS;
  }

  // ─── Auth ────────────────────────────────────────────

  async authenticate(): Promise<TradovateTokenResponse> {
    const res = await fetch(`${this.baseUrl}/auth/accessTokenRequest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: this.credentials.username,
        password: this.credentials.password,
        appId: this.credentials.appId || 'Haia',
        appVersion: this.credentials.appVersion || '1.0.0',
        cid: this.credentials.cid || 8,
        sec: this.credentials.sec || '',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tradovate auth failed (${res.status}): ${text}`);
    }

    const data = await res.json() as TradovateTokenResponse;
    this.accessToken = data.accessToken;
    this.mdAccessToken = data.mdAccessToken;
    this.tokenExpiresAt = new Date(data.expirationTime).getTime();
    this.userId = data.userId;
    return data;
  }

  async renewToken(): Promise<void> {
    if (!this.accessToken) throw new Error('No token to renew');
    const res = await fetch(`${this.baseUrl}/auth/renewAccessToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`,
      },
    });
    if (!res.ok) {
      await this.authenticate();
      return;
    }
    const data = await res.json();
    this.accessToken = data.accessToken;
    this.tokenExpiresAt = new Date(data.expirationTime).getTime();
  }

  private async ensureAuth(): Promise<string> {
    if (!this.accessToken || Date.now() > this.tokenExpiresAt - 5 * 60 * 1000) {
      if (this.accessToken) {
        await this.renewToken();
      } else {
        await this.authenticate();
      }
    }
    return this.accessToken!;
  }

  // ─── REST API ────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async request(method: string, path: string, body?: any): Promise<any> {
    const token = await this.ensureAuth();
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    };
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }
    const url = path.startsWith('http') ? path : `${this.baseUrl}/${path}`;
    const res = await fetch(url, options);

    if (!res.ok) {
      const text = await res.text();
      // Handle penalty ticket
      if (res.status === 429) {
        const data = JSON.parse(text);
        if (data['p-ticket'] && data['p-time']) {
          console.warn(`[tradovate] Rate limited — waiting ${data['p-time']}s`);
          await new Promise((r) => setTimeout(r, data['p-time'] * 1000));
          return this.request(method, path, { ...body, 'p-ticket': data['p-ticket'] });
        }
      }
      throw new Error(`Tradovate ${method} ${path} failed (${res.status}): ${text}`);
    }

    return res.json();
  }

  // ─── Account ─────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getAccounts(): Promise<any[]> {
    return this.request('GET', 'account/list');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getAccount(accountId: number): Promise<any> {
    return this.request('GET', `account/item?id=${accountId}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getPositions(): Promise<any[]> {
    return this.request('GET', 'position/list');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getCashBalances(): Promise<any[]> {
    return this.request('GET', 'cashBalance/list');
  }

  // ─── Orders ──────────────────────────────────────────

  async placeOrder(params: {
    accountId: number;
    action: 'Buy' | 'Sell';
    symbol: string;
    orderQty: number;
    orderType?: string;
    price?: number;
    stopPrice?: number;
    timeInForce?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }): Promise<any> {
    return this.request('POST', 'order/placeOrder', {
      accountSpec: this.credentials.username,
      accountId: params.accountId,
      action: params.action,
      symbol: params.symbol,
      orderQty: params.orderQty,
      orderType: params.orderType || 'Market',
      timeInForce: params.timeInForce || 'Day',
      price: params.price,
      stopPrice: params.stopPrice,
      isAutomated: true,
    });
  }

  async placeBracketOrder(params: {
    accountId: number;
    action: 'Buy' | 'Sell';
    symbol: string;
    orderQty: number;
    profitTarget?: number;
    stopLoss?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }): Promise<any> {
    return this.request('POST', 'orderStrategy/startOrderStrategy', {
      accountId: params.accountId,
      accountSpec: this.credentials.username,
      orderStrategyTypeId: 2,
      action: params.action,
      symbol: params.symbol,
      params: JSON.stringify({
        entryVersion: {
          orderQty: params.orderQty,
          orderType: 'Market',
          timeInForce: 'Day',
        },
        brackets: [{
          qty: params.orderQty,
          profitTarget: params.profitTarget,
          stopLoss: params.stopLoss ? -Math.abs(params.stopLoss) : undefined,
          trailingStop: false,
        }],
      }),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async liquidatePosition(accountId: number, contractId: number): Promise<any> {
    return this.request('POST', 'order/liquidatePosition', {
      accountId,
      contractId,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async modifyOrder(orderId: number, params: { price?: number; stopPrice?: number; orderQty?: number }): Promise<any> {
    return this.request('POST', 'order/modifyOrder', {
      orderId,
      ...params,
      isAutomated: true,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async findContract(symbol: string): Promise<any> {
    return this.request('GET', `contract/find?name=${encodeURIComponent(symbol)}`);
  }

  // ─── WebSocket ───────────────────────────────────────

  async connectWebSocket(): Promise<void> {
    if (!WebSocket) {
      WebSocket = require('ws');
    }
    const token = await this.ensureAuth();

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      ws.on('open', () => {
        ws.send(`authorize\n0\n\n${token}`);
      });

      ws.on('message', (raw: Buffer) => {
        const msg = raw.toString();
        if (msg === 'o') return;
        if (msg === 'h') return;
        if (msg.startsWith('c')) {
          console.warn('[tradovate-ws] Connection closed by server');
          return;
        }
        if (!msg.startsWith('a')) return;

        try {
          const frames = JSON.parse(msg.slice(1));
          for (const frame of frames) {
            // Auth response
            if (frame.i === 0 && frame.s === 200) {
              this.subscribeUserSync();
              resolve();
              continue;
            }
            if (frame.i === 0 && frame.s !== 200) {
              reject(new Error(`Tradovate WS auth failed: ${JSON.stringify(frame)}`));
              continue;
            }
            // Pending request response
            if (frame.i && this.pendingRequests.has(frame.i)) {
              const pending = this.pendingRequests.get(frame.i)!;
              this.pendingRequests.delete(frame.i);
              if (frame.s === 200) pending.resolve(frame.d);
              else pending.reject(new Error(`WS request ${frame.i} failed: ${JSON.stringify(frame)}`));
              continue;
            }
            // Entity updates (from user/syncrequest)
            if (frame.e) {
              const listeners = this.entityListeners.get(frame.e) || [];
              for (const cb of listeners) cb(frame.d);
            }
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.on('error', (err: Error) => {
        console.error('[tradovate-ws] Error:', err.message);
        reject(err);
      });

      ws.on('close', () => {
        console.log('[tradovate-ws] Disconnected');
      });
    });
  }

  private subscribeUserSync(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const id = this.requestId++;
    this.ws.send(`user/syncrequest\n${id}\n\n${JSON.stringify({ users: [this.userId] })}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEntity(entityType: string, callback: (data: any) => void): void {
    const existing = this.entityListeners.get(entityType) || [];
    existing.push(callback);
    this.entityListeners.set(entityType, existing);
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getUserId(): number { return this.userId; }
  getAccessToken(): string | null { return this.accessToken; }
}
