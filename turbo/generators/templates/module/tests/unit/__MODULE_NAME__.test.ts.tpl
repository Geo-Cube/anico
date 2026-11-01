import { describe, expect, it } from 'vitest';
import { create__MODULE_PASCAL__, list__MODULE_PASCAL__ } from '../../src/modules/__MODULE_NAME__/application/records.js';
import type { __MODULE_PASCAL__Record, __MODULE_PASCAL__Repository } from '../../src/modules/__MODULE_NAME__/domain/entity.js';
describe('__MODULE_NAME__ use cases', () => {
  it('enforces domain rules without a database and normalizes valid names', async () => {
    const records: __MODULE_PASCAL__Record[] = [];
    const repository: __MODULE_PASCAL__Repository = {
      async create(input) { const record = { id: 'example', ...input }; records.push(record); return record; },
      async list() { return records; },
    };
    const create = create__MODULE_PASCAL__(repository);
    expect(() => create({ name: ' ' })).toThrow();
    expect(() => create({ name: 'x'.repeat(121) })).toThrow();
    expect(records).toEqual([]);
    expect((await create({ name: ' Example ' })).name).toBe('Example');
    expect(await list__MODULE_PASCAL__(repository)()).toEqual(records);
  });
});
