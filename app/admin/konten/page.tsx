import { AdminDeleteUser } from '@/components/admin'
import { adminUsers } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth'
import { formatDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  const admin = await requireAdmin()
  const users = adminUsers()
  return (
    <>
      <p className="mb-3 text-[14px] text-ink-dim">
        {users.length} {users.length === 1 ? 'Konto' : 'Konten'}. Admin-Rechte vergibst du auf dem Server mit{' '}
        <code className="bg-panel-2 px-1.5 py-0.5 font-mono text-[13px]">node scripts/make-admin.mjs &lt;e-mail&gt;</code>.
      </p>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-[14px]">
          <thead className="border-b border-line text-[12px] uppercase tracking-[0.08em] text-ink-faint">
            <tr>
              <th className="px-4 py-3 font-semibold">E-Mail</th>
              <th className="px-4 py-3 font-semibold">Welten</th>
              <th className="px-4 py-3 font-semibold">Konto seit</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-3">
                  <span className="break-all font-semibold">{user.email}</span>
                  {user.isAdmin && (
                    <span className="ml-2 bg-accent px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase text-accent-ink">
                      Admin
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-ink-dim">{user.worlds}</td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-dim">{formatDateTime(user.createdAt)}</td>
                <td className="px-4 py-2 text-right">
                  {!user.isAdmin && user.id !== admin.id && <AdminDeleteUser userId={user.id} email={user.email} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
