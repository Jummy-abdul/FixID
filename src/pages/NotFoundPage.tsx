import { SearchX } from 'lucide-react';
import { ButtonLink, Card, EmptyState } from '@/components/ui';

export function NotFoundPage({ entity, backTo = '/' }: { entity?: string; backTo?: string }) {
  return (
    <Card className="mt-6">
      <EmptyState
        icon={<SearchX className="h-5 w-5" />}
        title={entity ? `This ${entity} was not found` : 'Page not found'}
        description={entity ? `It may belong to another organization, or the demo data may have been reset.` : 'The page you are looking for does not exist.'}
        action={<ButtonLink to={backTo}>Go back</ButtonLink>}
      />
    </Card>
  );
}
