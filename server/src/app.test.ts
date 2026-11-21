import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { HealthResponseSchema } from '@mdw/shared';
import { createApp } from './app.js';

const app = createApp({ CLIENT_ORIGIN: 'http://localhost:5173' });

describe('GET /api/health', () => {
  it('returns a body that matches the shared HealthResponse contract', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    const parsed = HealthResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
  });

  it('allows the Vite dev origin via CORS', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});

describe('unknown API routes', () => {
  it('returns the standard JSON error envelope with 404', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
