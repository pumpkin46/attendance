import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import AppLayout from './layouts/AppLayout'
import AnomaliesPage from './pages/AnomaliesPage'
import AttendancePage from './pages/AttendancePage'
import AuditLogsPage from './pages/AuditLogsPage'
import CamerasPage from './pages/CamerasPage'
import DashboardPage from './pages/DashboardPage'
import MonitoringPage from './pages/MonitoringPage'
import AccessControlPage from './pages/AccessControlPage'
import VisitorsPage from './pages/VisitorsPage'
import EmployeesPage from './pages/EmployeesPage'
import EnrollmentPage from './pages/EnrollmentPage'
import LiveKioskPage from './pages/LiveKioskPage'
import RecognitionTestPage from './pages/RecognitionTestPage'
import LivenessTestPage from './pages/LivenessTestPage'
import LoginPage from './pages/LoginPage'
import ReportsPage from './pages/ReportsPage'
import RfidPage from './pages/RfidPage'
import ShiftsPage from './pages/ShiftsPage'
import UnknownFacesPage from './pages/UnknownFacesPage'
import SecurityTenancyPage from './pages/SecurityTenancyPage'
import SmartBuildingPage from './pages/SmartBuildingPage'
import SecurityMonitoringPage from './pages/SecurityMonitoringPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
      </BrowserRouter>
    </AuthProvider>
  )
}
