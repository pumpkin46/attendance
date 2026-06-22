import { PageHeader } from '@/shared/ui/PageHeader'
import { TenancyDirectory } from '@/features/security/components/TenancyDirectory'

/**
 * Dedicated Organizations page — the org-chart canvas plus org-unit management.
 * Wraps the shared directory scoped to its organizations section.
 */
export default function OrganizationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        description="Your organization structure as an interactive chart — expand branches, and (with manage access) drag units to re-parent, add, or edit them."
      />
      <TenancyDirectory only="organizations" />
    </div>
  )
}
