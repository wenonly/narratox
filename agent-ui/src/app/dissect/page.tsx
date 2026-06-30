import RequireAuth from '@/components/auth/RequireAuth'
import DissectPage from '@/components/dissect/DissectPage'

export default function Page() {
  return (
    <RequireAuth>
      <DissectPage />
    </RequireAuth>
  )
}
