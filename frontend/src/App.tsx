import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider } from './contexts/AuthContext'
import { RealtimeProvider } from './contexts/RealtimeContext'
import AppLayout from './layouts/AppLayout'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const MonitoringPage = lazy(() => import('./pages/MonitoringPage'))
const AccessControlPage = lazy(() => import('./pages/AccessControlPage'))
const VisitorsPage = lazy(() => import('./pages/VisitorsPage'))
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'))
const EnrollmentPage = lazy(() => import('./pages/EnrollmentPage'))
const LiveKioskPage = lazy(() => import('./pages/LiveKioskPage'))
const RecognitionTestPage = lazy(() => import('./pages/RecognitionTestPage'))
const LivenessTestPage = lazy(() => import('./pages/LivenessTestPage'))
const AttendancePage = lazy(() => import('./pages/AttendancePage'))
const AnomaliesPage = lazy(() => import('./pages/AnomaliesPage'))
const ShiftsPage = lazy(() => import('./pages/ShiftsPage'))
const CamerasPage = lazy(() => import('./pages/CamerasPage'))
const RfidPage = lazy(() => import('./pages/RfidPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const UnknownFacesPage = lazy(() => import('./pages/UnknownFacesPage'))
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage'))
const SecurityTenancyPage = lazy(() => import('./pages/SecurityTenancyPage'))
const SmartBuildingPage = lazy(() => import('./pages/SmartBuildingPage'))
const SecurityMonitoringPage = lazy(() => import('./pages/SecurityMonitoringPage'))
const RecognitionEnginePage = lazy(() => import('./pages/RecognitionEnginePage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))

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
