import type { PoolClient } from 'pg';
import type { MutationKind, MutationParsed, MutationResult } from '@mpe/shared';
import type { AuthContext } from '../../auth/types';

export interface HandlerContext {
  client: PoolClient;                 // inside the mutation's transaction
  auth: AuthContext;
  deviceId: string;
  publicWebUrl: string;
}

export interface HandlerResult {
  /** Server truth after applying. */
  row?: Record<string, unknown>;
  /** Table the row belongs to; defaults to the mutation's entity. */
  rowEntity?: NonNullable<MutationResult['rowEntity']>;
}

export type Handler<K extends MutationKind> = (
  ctx: HandlerContext,
  mutation: { entityId: string; payload: MutationParsed<K> },
) => Promise<HandlerResult>;

/** The mutation can never succeed as sent (bad reference, not allowed, breaks a rule). The client must not retry it. */
export class MutationRejected extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'MutationRejected';
    this.code = code;
  }
}

/** The mutation is valid, but the server moved on. Carries the server's current row so the client can adopt it. */
export class MutationConflict extends Error {
  readonly row: Record<string, unknown>;
  readonly rowEntity: NonNullable<MutationResult['rowEntity']>;
  constructor(message: string, row: Record<string, unknown>, rowEntity: NonNullable<MutationResult['rowEntity']>) {
    super(message);
    this.name = 'MutationConflict';
    this.row = row;
    this.rowEntity = rowEntity;
  }
}
