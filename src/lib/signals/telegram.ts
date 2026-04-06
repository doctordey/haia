/**
 * Telegram Signal Client — GramJS MTProto user client wrapper
 *
 * Uses the `telegram` npm package (GramJS) for direct MTProto access.
 * This is a user client, NOT a bot — it can listen to any channel the user
 * is a member of without needing bot permissions.
 */

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, type NewMessageEvent } from 'telegram/events';
import { computeCheck } from 'telegram/Password';

export interface TelegramAuthState {
  phoneCodeHash: string;
  phone: string;
}

export class TelegramSignalClient {
  private client: TelegramClient;
  private apiId: number;
  private apiHash: string;
  private sessionString: string;
  private _connected = false;

  // Held during auth flow
  private pendingAuth: TelegramAuthState | null = null;

  constructor(apiId: number, apiHash: string, sessionString: string = '') {
    this.apiId = apiId;
    this.apiHash = apiHash;
    this.sessionString = sessionString;
    this.client = new TelegramClient(
      new StringSession(sessionString),
      apiId,
      apiHash,
      {
        connectionRetries: 5,
        autoReconnect: true,
      },
    );
  }

  async connect(): Promise<void> {
    if (this._connected) return;
    await this.client.connect();
    this._connected = true;
    console.log('[telegram] Client connected');
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    await this.client.disconnect();
    this._connected = false;
    console.log('[telegram] Client disconnected');
  }

  isConnected(): boolean {
    return this._connected;
  }

  getSessionString(): string {
    return this.client.session.save() as unknown as string;
  }

  // ─── Auth Flow ──────────────────────────────────

  /**
   * Step 1: Send verification code to the user's phone.
   */
  async sendCode(phone: string): Promise<TelegramAuthState> {
    await this.connect();
    const result = await this.client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: this.apiId,
        apiHash: this.apiHash,
        settings: new Api.CodeSettings({
          allowFlashcall: false,
          currentNumber: false,
          allowAppHash: false,
        }),
      }),
    );

    if (!(result instanceof Api.auth.SentCode)) {
      throw new Error('Unexpected response — user may already be authorized');
    }

    this.pendingAuth = {
      phoneCodeHash: result.phoneCodeHash,
      phone,
    };

    return this.pendingAuth;
  }

  /**
   * Step 2: Verify the code (and optional 2FA password).
   */
  async signIn(
    phone: string,
    code: string,
    phoneCodeHash: string,
    password?: string,
  ): Promise<string> {
    await this.connect();

    try {
      await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash,
          phoneCode: code,
        }),
      );
    } catch (err: unknown) {
      const error = err as { errorMessage?: string };
      if (error.errorMessage === 'SESSION_PASSWORD_NEEDED' && password) {
        // 2FA required — compute SRP check
        const srpResult = await this.client.invoke(new Api.account.GetPassword());
        const srpCheck = await computeCheck(srpResult, password);
        await this.client.invoke(
          new Api.auth.CheckPassword({ password: srpCheck }),
        );
      } else {
        throw err;
      }
    }

    this.pendingAuth = null;
    return this.getSessionString();
  }

  getPendingAuth(): TelegramAuthState | null {
    return this.pendingAuth;
  }

  // ─── Channel Listening ──────────────────────────

  /**
   * Subscribe to new messages from a specific channel.
   * The callback receives the raw message text.
   */
  listenToChannel(
    channelId: string | number,
    callback: (text: string, messageId: number) => void,
  ): void {
    this.client.addEventHandler(
      (event: NewMessageEvent) => {
        const message = event.message;
        if (message.text) {
          callback(message.text, message.id);
        }
      },
      new NewMessage({ chats: [channelId] }),
    );

    console.log(`[telegram] Listening to channel: ${channelId}`);
  }

  /**
   * Resolve a channel by its username or ID.
   */
  async resolveChannel(channelIdentifier: string | number): Promise<{
    id: string;
    title: string;
  } | null> {
    try {
      const entity = await this.client.getEntity(channelIdentifier);
      if (entity instanceof Api.Channel || entity instanceof Api.Chat) {
        return {
          id: String(entity.id),
          title: (entity as Api.Channel).title || String(entity.id),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if the client is authenticated (has a valid session).
   */
  async isAuthorized(): Promise<boolean> {
    try {
      await this.connect();
      return await this.client.isUserAuthorized();
    } catch {
      return false;
    }
  }
}

// In-memory instance for the auth flow (API routes share this during auth)
let _authClient: TelegramSignalClient | null = null;

export function getOrCreateAuthClient(): TelegramSignalClient {
  if (!_authClient) {
    const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
    const apiHash = process.env.TELEGRAM_API_HASH || '';
    if (!apiId || !apiHash) {
      throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH must be set');
    }
    _authClient = new TelegramSignalClient(apiId, apiHash);
  }
  return _authClient;
}

export function clearAuthClient(): void {
  if (_authClient) {
    _authClient.disconnect().catch(() => {});
    _authClient = null;
  }
}
