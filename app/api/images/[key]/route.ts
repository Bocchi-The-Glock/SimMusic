import { endpoint } from '@/lib/server/core';
import { readImage } from '@/lib/server/images';
export async function GET(_request: Request, context: {params: Promise<{key:string}>}) {
  return endpoint(async () => readImage((await context.params).key));
}
