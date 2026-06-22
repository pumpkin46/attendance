import { PageHeader } from '@/shared/ui/PageHeader'
import { TenancyDirectory } from '@/features/security/components/TenancyDirectory'

/**
 * Dedicated Locations page — physical sites and facilities. Wraps the shared
 * directory scoped to its locations section.
 */
export default function LocationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations"
        description="Manage physical sites and facilities across your organization."
      />
      <TenancyDirectory only="locations" />
    </div>
  )
}
