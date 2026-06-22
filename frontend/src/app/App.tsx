import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from '@/features/auth/ProtectedRoute'
import { RequirePermission } from '@/features/auth/RequirePermission'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { NotFoundPage } from '@/shared/components/StatusScreen'
import { Loading } from '@/shared/ui/Loading'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { RealtimeProvider } from '@/features/realtime/RealtimeContext'
import { ROUTE_PERMISSIONS } from '@/app/access'
import AppLayout from '@/layouts/AppLayout'
import { isDesktopApp, DRAG_REGION } from '@/shared/lib/desktop'

const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
const ChatPage = lazy(() => import('@/features/chat/ChatPage'))
const VisitorsPage = lazy(() => import('@/features/visitors/VisitorsPage'))
const EmployeesPage = lazy(() => import('@/features/employees/EmployeesPage'))
const EnrollmentPage = lazy(() => import('@/features/enrollment/EnrollmentPage'))
const SimpleEnrollmentPage = lazy(() => import('@/features/enrollment/SimpleEnrollmentPage'))
const LiveKioskPage = lazy(() => import('@/features/kiosk/LiveKioskPage'))
const RecognitionTestPage = lazy(() => import('@/features/recognition/RecognitionTestPage'))
const LivenessTestPage = lazy(() => import('@/features/recognition/LivenessTestPage'))
const AttendancePage = lazy(() => import('@/features/attendance/AttendancePage'))
const AnomaliesPage = lazy(() => import('@/features/anomalies/AnomaliesPage'))
const ShiftsPage = lazy(() => import('@/features/shifts/ShiftsPage'))
const CamerasPage = lazy(() => import('@/features/cameras/CamerasPage'))
const RfidPage = lazy(() => import('@/features/rfid/RfidPage'))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'))
const UnknownFacesPage = lazy(() => import('@/features/recognition/UnknownFacesPage'))
const AuditLogsPage = lazy(() => import('@/features/audit/AuditLogsPage'))
const SecurityTenancyPage = lazy(() => import('@/features/security/SecurityTenancyPage'))
const OrganizationsPage = lazy(() => import('@/features/security/OrganizationsPage'))
const LocationsPage = lazy(() => import('@/features/security/LocationsPage'))
const RecognitionEnginePage = lazy(() => import('@/features/recognition/RecognitionEnginePage'))
const PrivacyPage = lazy(() => import('@/features/privacy/PrivacyPage'))
const ProfilePage = lazy(() => import('@/features/auth/ProfilePage'))
const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
const RegisterPage = lazy(() => import('@/features/auth/RegisterPage'))
const SetupPage = lazy(() => import('@/features/auth/SetupPage'))
const UserManagementPage = lazy(() => import('@/features/users/UserManagementPage'))

function FullScreenFallback() {
  return <Loading fullScreen />
}

/** Wraps a route element in its permission guard when one is configured. */
function guard(path: string, element: ReactNode): ReactNode {
  const permission = ROUTE_PERMISSIONS[path]
  return permission ? <RequirePermission permission={permission}>{element}</RequirePermission> : element
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <RealtimeProvider>
          <BrowserRouter>
          {/* Frameless desktop app: a thin always-draggable strip along the very
              top edge, so screens without the app header (login, setup) can still
              move the window. No-op in a browser. */}
          {isDesktopApp() && (
            <div className={`fixed inset-x-0 top-0 z-[100] h-1.5 ${DRAG_REGION}`} aria-hidden />
          )}
          <Suspense fallback={<FullScreenFallback />}>
            <Routes>
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="chat" element={<ChatPage />} />
                <Route path="visitors" element={<VisitorsPage />} />
                <Route path="employees" element={guard('/employees', <EmployeesPage />)} />
                <Route path="enrollment" element={guard('/enrollment', <EnrollmentPage />)} />
                <Route path="enrollment-simple" element={guard('/enrollment-simple', <SimpleEnrollmentPage />)} />
                <Route path="live-kiosk" element={<LiveKioskPage />} />
                <Route path="liveness-test" element={<LivenessTestPage />} />
                <Route path="recognition-test" element={<RecognitionTestPage />} />
                <Route path="attendance" element={<AttendancePage />} />
                <Route path="anomalies" element={guard('/anomalies', <AnomaliesPage />)} />
                <Route path="shifts" element={<ShiftsPage />} />
                <Route path="cameras" element={guard('/cameras', <CamerasPage />)} />
                <Route path="rfid" element={guard('/rfid', <RfidPage />)} />
                <Route path="reports" element={guard('/reports', <ReportsPage />)} />
                <Route path="unknown-faces" element={guard('/unknown-faces', <UnknownFacesPage />)} />
                <Route path="audit-logs" element={guard('/audit-logs', <AuditLogsPage />)} />
                <Route path="security" element={guard('/security', <SecurityTenancyPage />)} />
                <Route path="organizations" element={guard('/organizations', <OrganizationsPage />)} />
                <Route path="locations" element={guard('/locations', <LocationsPage />)} />
                <Route path="user-management" element={guard('/user-management', <UserManagementPage />)} />
                {/* The AI security monitoring page moved to /reports; keep old links working. */}
                <Route path="security-monitoring" element={<Navigate to="/reports" replace />} />
                <Route path="recognition-engine" element={guard('/recognition-engine', <RecognitionEnginePage />)} />
                <Route path="privacy" element={<PrivacyPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
              <Route
                path="/kiosk"
                element={
                  <ProtectedRoute>
                    <LiveKioskPage fullscreen />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </Suspense>
          </BrowserRouter>
        </RealtimeProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
