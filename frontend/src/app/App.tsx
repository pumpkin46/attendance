import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from '@/features/auth/ProtectedRoute'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { RealtimeProvider } from '@/features/realtime/RealtimeContext'
import AppLayout from '@/layouts/AppLayout'

const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
const MonitoringPage = lazy(() => import('@/features/monitoring/MonitoringPage'))
const AccessControlPage = lazy(() => import('@/features/access/AccessControlPage'))
const VisitorsPage = lazy(() => import('@/features/visitors/VisitorsPage'))
const EmployeesPage = lazy(() => import('@/features/employees/EmployeesPage'))
const EnrollmentPage = lazy(() => import('@/features/enrollment/EnrollmentPage'))
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
const SmartBuildingPage = lazy(() => import('@/features/building/SmartBuildingPage'))
const SecurityMonitoringPage = lazy(() => import('@/features/security/SecurityMonitoringPage'))
const RecognitionEnginePage = lazy(() => import('@/features/recognition/RecognitionEnginePage'))
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'))
const PrivacyPage = lazy(() => import('@/features/privacy/PrivacyPage'))
const LoginPage = lazy(() => import('@/features/auth/LoginPage'))

function FullScreenFallback() {
  return <div className="grid min-h-screen place-items-center text-slate-400">Loading…</div>
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <RealtimeProvider>
          <BrowserRouter>
          <Suspense fallback={<FullScreenFallback />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<MonitoringPage />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="monitoring" element={<MonitoringPage />} />
                <Route path="access-control" element={<AccessControlPage />} />
                <Route path="visitors" element={<VisitorsPage />} />
                <Route path="employees" element={<EmployeesPage />} />
                <Route path="enrollment" element={<EnrollmentPage />} />
                <Route path="live-kiosk" element={<LiveKioskPage />} />
                <Route path="liveness-test" element={<LivenessTestPage />} />
                <Route path="recognition-test" element={<RecognitionTestPage />} />
                <Route path="attendance" element={<AttendancePage />} />
                <Route path="anomalies" element={<AnomaliesPage />} />
                <Route path="shifts" element={<ShiftsPage />} />
                <Route path="cameras" element={<CamerasPage />} />
                <Route path="rfid" element={<RfidPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="unknown-faces" element={<UnknownFacesPage />} />
                <Route path="audit-logs" element={<AuditLogsPage />} />
                <Route path="security" element={<SecurityTenancyPage />} />
                <Route path="smart-building" element={<SmartBuildingPage />} />
                <Route path="security-monitoring" element={<SecurityMonitoringPage />} />
                <Route path="recognition-engine" element={<RecognitionEnginePage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="privacy" element={<PrivacyPage />} />
              </Route>
              <Route
                path="/kiosk"
                element={
                  <ProtectedRoute>
                    <LiveKioskPage fullscreen />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          </BrowserRouter>
        </RealtimeProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
