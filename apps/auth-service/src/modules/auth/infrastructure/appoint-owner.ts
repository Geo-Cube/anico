import type { Connection } from 'mongoose';
import { z } from 'zod';
import type { User } from '../domain/auth.js';
/** Operator-only bootstrap. Never called by registration or public HTTP routes. */
export async function appointInitialOwner(
  connection: Connection,
  userId: string,
  confirmation: string,
) {
  z.uuid().parse(userId);
  if (confirmation !== userId) throw new Error('Confirmation required');
  const users = connection.db!.collection<
    User & {
      ownerSlot?: string;
      issuer?: string;
      subject?: string;
      roleAudit?: Array<{ action: string; at: Date }>;
    }
  >('users');
  if (await users.findOne({ ownerSlot: 'primary' }))
    throw new Error('Owner already exists');
  const result = await users.updateOne(
    {
      userId,
      status: 'active',
      fixture: { $ne: true },
      issuer: { $type: 'string' },
      subject: { $type: 'string' },
    },
    {
      $addToSet: { roles: 'owner' },
      $set: { ownerSlot: 'primary' },
      $push: { roleAudit: { action: 'bootstrap-owner', at: new Date() } },
    },
  );
  if (result.modifiedCount !== 1) throw new Error('No eligible user');
}
