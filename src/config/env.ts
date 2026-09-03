import path from 'node:path';

// ponytail: env via plain reads; switch to zod-validated schema once >3 vars
export const config = {
  dataDir: process.env.GUITAR_DATA_DIR ?? path.join(process.cwd(), '.data'),
  songsDir: path.join(
    process.env.GUITAR_DATA_DIR ?? path.join(process.cwd(), '.data'),
    'songs',
  ),
};
