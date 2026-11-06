import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  adminHeaders,
  breederHeaders,
  submit,
  takeOverAndSubmit,
} from '../support/api.js';
import { testApp } from '../support/app.js';
import { decideRequest } from '../support/qa.js';

describe('POST /verification-requests/:id/decision – revize podání', () => {
  it.each([
    [{ decision: 'APPROVED' }],
    [{ decision: 'REJECTED', rejectionReason: 'Nesedí' }],
    [{ decision: 'RETURNED', returnReason: 'Doplňte' }],
    [{ decision: 'APPROVED', revision: 0 }],
    [{ decision: 'APPROVED', revision: 1.5 }],
    [{ decision: 'APPROVED', revision: '1' }],
    [{ decision: 'APPROVED', revision: null }],
  ])(
    'bez platné revize %j -> 400 Validation failed, nic se nezmění',
    async (body) => {
      const { app, breeders, notifyDecision } = testApp();
      const id = await takeOverAndSubmit(app, 'b1');

      const response = await decideRequest(app, id, body);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['revision'] }),
        ]),
      );
      expect(
        (await breeders.findByBreederId('b1'))?.verificationRequest,
      ).toMatchObject({ status: 'PENDING', revision: 1, reviewHistory: [] });
      expect(notifyDecision).not.toHaveBeenCalled();
    },
  );

  it('neznámá vyšší revize -> 409 revision mismatch s aktuálním stavem, bez e-mailu', async () => {
    const { app, breeders, notifyDecision } = testApp();
    const id = await takeOverAndSubmit(app, 'b1');

    const response = await decideRequest(app, id, {
      decision: 'APPROVED',
      revision: 2,
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: 'Verification revision mismatch',
      current: { id, status: 'PENDING', revision: 1, reviewHistory: [] },
    });
    expect((await breeders.findByBreederId('b1'))?.isVerified).toBe(false);
    expect(notifyDecision).not.toHaveBeenCalled();
  });

  it('starší revize po opravě -> 409 revision mismatch; rozhodnutá žádost má přednost jako already decided', async () => {
    const { app, notifyDecision } = testApp();
    const id = await takeOverAndSubmit(app, 'b1');
    await decideRequest(app, id, {
      decision: 'RETURNED',
      revision: 1,
      returnReason: 'Doplňte',
    }).expect(200);
    await submit(app, breederHeaders('b1'), { file: null }).expect(201);
    notifyDecision.mockClear();

    const stale = await decideRequest(app, id, {
      decision: 'REJECTED',
      revision: 1,
      rejectionReason: 'Pozdě',
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: 'Verification revision mismatch',
      current: { status: 'PENDING', revision: 2 },
    });

    await decideRequest(app, id, { decision: 'APPROVED', revision: 2 }).expect(
      200,
    );
    const decided = await decideRequest(app, id, {
      decision: 'APPROVED',
      revision: 1,
    });
    expect(decided.status).toBe(409);
    expect(decided.body).toMatchObject({
      error: 'Verification already decided',
      current: { status: 'APPROVED', revision: 2 },
    });
    expect(notifyDecision).toHaveBeenCalledOnce();
  });

  it('souběh vrácení a schválení stejné revize -> [200,409], jeden záznam historie', async () => {
    const { app, breeders, notifyDecision } = testApp();
    const id = await takeOverAndSubmit(app, 'b1');

    const responses = await Promise.all([
      decideRequest(
        app,
        id,
        { decision: 'RETURNED', revision: 1, returnReason: 'Doplňte' },
        'admin-1',
      ),
      decideRequest(app, id, { decision: 'APPROVED', revision: 1 }, 'admin-2'),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = responses.find((r) => r.status === 409)!;
    expect(loser.body.error).toBe('Verification already decided');
    const stored = await breeders.findByBreederId('b1');
    expect(stored?.verificationRequest?.reviewHistory).toEqual([
      expect.objectContaining({ revision: 1 }),
    ]);
    expect(stored?.isVerified).toBe(
      stored?.verificationRequest?.status === 'APPROVED',
    );
    expect(notifyDecision).toHaveBeenCalledOnce();
  });

  it('revize je v účtu chovatele, detailu, frontě i historii', async () => {
    const { app } = testApp();
    const id = await takeOverAndSubmit(app, 'b1');
    await decideRequest(app, id, {
      decision: 'RETURNED',
      revision: 1,
      returnReason: 'Doplňte',
    }).expect(200);
    const corrected = await submit(app, breederHeaders('b1'), {
      file: null,
    }).expect(201);

    expect(corrected.body.verificationRequest).toMatchObject({ revision: 2 });
    const detail = await request(app)
      .get(`/verification-requests/${id}`)
      .set(adminHeaders())
      .expect(200);
    expect(detail.body).toMatchObject({
      revision: 2,
      reviewHistory: [{ decision: 'RETURNED', revision: 1 }],
    });
    const queue = await request(app)
      .get('/verification-requests')
      .set(adminHeaders())
      .expect(200);
    expect(queue.body.items[0]).toMatchObject({ id, revision: 2 });
  });
});
