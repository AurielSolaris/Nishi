import type { APIRoute } from 'astro';
import apache from '../../../../LICENSE?raw';
import lucide from '../../../../desktop/src/main/resources/dev/nishi/desktop/icons/LICENSE-LUCIDE?raw';
import notice from '../../../../NOTICE.md?raw';

const notices = { apache, lucide, notice };

export function getStaticPaths() {
  return Object.entries(notices).map(([name, contents]) => ({
    params: { notice: name }, props: { contents },
  }));
}

export const GET: APIRoute = ({ props }) => new Response(props.contents);
