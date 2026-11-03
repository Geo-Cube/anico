import type { Connection } from 'mongoose';
import type {
  DevelopmentRepository,
  DevelopmentRequest,
  DevelopmentCode,
  DevelopmentSession,
} from '../domain/development.js';

export function mongoDevelopmentRepository(
  connection: Connection,
): DevelopmentRepository {
  const requests = connection.db!.collection<
    DevelopmentRequest & { _id: string }
  >('development_requests');
  const codes = connection.db!.collection<DevelopmentCode & { _id: string }>(
    'development_codes',
  );
  const sessions = connection.db!.collection<
    DevelopmentSession & { _id: string }
  >('development_sessions');
  return {
    async saveRequest(hash, request) {
      await requests.insertOne({ _id: hash, ...request });
    },
    request: (hash, now) =>
      requests.findOne({ _id: hash, expiresAt: { $gt: now } }),
    consumeRequest: (hash, now) =>
      requests.findOneAndDelete({ _id: hash, expiresAt: { $gt: now } }),
    async saveCode(hash, code) {
      await codes.insertOne({ _id: hash, ...code });
    },
    consumeCode: (hash, challenge, redirectUri, now) =>
      codes.findOneAndDelete({
        _id: hash,
        challenge,
        redirectUri,
        expiresAt: { $gt: now },
      }),
    async saveSession(hash, session) {
      await sessions.insertOne({ _id: hash, ...session });
    },
    session: (hash, now) =>
      sessions.findOne({ _id: hash, expiresAt: { $gt: now } }),
    async revoke(hash) {
      await sessions.deleteOne({ _id: hash });
    },
  };
}
