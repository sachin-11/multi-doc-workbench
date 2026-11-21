import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { LimitsResponseSchema } from '@mdw/shared';
import { createTestApp } from '../testing/testApp.js';

describe('GET /api/limits', () => {
  it('returns the runtime limits the server enforces', async () => {
    const ctx = createTestApp({ maxFiles: 4, maxFileSizeMb: 3 });
    try {
      const res = await request(ctx.app).get('/api/limits');
      expect(res.status).toBe(200);
      const limits = LimitsResponseSchema.parse(res.body);
      expect(limits.maxFiles).toBe(4);
      expect(limits.maxFileSizeMb).toBe(3);
      expect(limits.allowedExtensions).toContain('.pdf');
    } finally {
      ctx.close();
    }
  });
});
