import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import AppLayout from './layouts/AppLayout'
import AttendancePage from './pages/AttendancePage'
import AuditLogsPage from './pages/AuditLogsPage'
import CamerasPage from './pages/CamerasPage'
import DashboardPage from './pages/DashboardPage'
import EmployeesPage from './pages/EmployeesPage'
import EnrollmentPage from './pages/EnrollmentPage'
import LiveKioskPage from './pages/LiveKioskPage'
import RecognitionTestPage from './pages/RecognitionTestPage'
import LoginPage from './pages/LoginPage'
import ReportsPage from './pages/ReportsPage'
import ShiftsPage from './pages/ShiftsPage'
import UnknownFacesPage from './pages/UnknownFacesPage'

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
            <Route index element={<DashboardPage />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="enrollment" element={<EnrollmentPage />} />
            <Route path="recognition-test" element={<RecognitionTestPage />} />
            <Route path="live-kiosk" element={<LiveKioskPage />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="shifts" element={<ShiftsPage />} />
            <Route path="cameras" element={<CamerasPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="unknown-faces" element={<UnknownFacesPage />} />
            <Route path="audit-logs" element={<AuditLogsPage />} />
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
