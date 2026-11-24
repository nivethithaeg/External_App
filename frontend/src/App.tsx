import { OwnerPayoutsPage } from './pages/owner/OwnerPayouts';
import { AreaDetailsPage } from './pages/owner/AreaDetails';
import { Suspense, lazy, useEffect, type ComponentType } from 'react';
import { WalletPage } from './pages/customer/Wallet';
import { StaffBookings, StaffCalendar, StaffDashboard, StaffHome, StaffLayout, StaffNewBooking, StaffPricing, StaffProfile, StaffReports, StaffVenues } from './pages/staff/StaffPortal';
import { PaymentCelebrationHost } from './lib/paymentCelebration';
import { Link, Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CustomerLayout, PortalLayout, RequireRole, adminGroups, ownerGroups } from './components/Layouts';
import { ForgotPasswordPage, LoginPage, RegisterPage, VerifyAccountPage, CompleteProfilePage } from './pages/auth/AuthPages';
import { ApplicationPage, OwnerGate, OwnerRegisterPage, OwnerWelcomePage, PendingOverview, usePendingApproval } from './pages/owner/OwnerOnboarding';
import { HomePage, VenueDetailPage, VenuesPage } from './pages/customer/Discover';
import { ReceiptPage, MyReviewsPage, NearbyPage, OffersPage, PaymentsPage as CustomerPaymentsPage, SettingsPage, SportsPage } from './pages/customer/Portal';
import { BookingDetailPage, BookingsPage, FavouritesPage, NotificationsPage, ProfilePage, SupportPage } from './pages/customer/Account';
import { AboutPage, CancellationPage, ContactPage, CookiePage, HelpPage, OwnerAgreementPage, PrivacyPage, TermsPage } from './pages/customer/InfoPages';
import { Loading } from './components/ui';
import { OfflineBookingPage } from './pages/owner/OfflineBooking';
import { useAuth } from './lib/auth';

const OwnerVenuesPage = lazy(() => import('./pages/owner/VenueEditor').then((m) => ({ default: m.OwnerVenuesPage })));
const VenueEditorPage = lazy(() => import('./pages/owner/VenueEditor').then((m) => ({ default: m.VenueEditorPage })));
const op = (file: 'OwnerOps' | 'OwnerSchedule' | 'OwnerMoney' | 'OwnerAccount' | 'OwnerPages' | 'OwnerStaff' | 'OwnerCustomers' | 'OwnerExtras', name: string) => lazy<ComponentType<any>>(() => import(`./pages/owner/${file}.tsx`).then((m) => ({ default: (m as any)[name] })));
const OverviewPage = op('OwnerOps', 'OverviewPage'), AreasPage = op('OwnerOps', 'AreasPage'), HoursPage = op('OwnerOps', 'HoursPage'), PricingPage = op('OwnerOps', 'PricingPage');
const CalendarPage = op('OwnerSchedule', 'CalendarPage'), SlotsPage = op('OwnerSchedule', 'SlotsPage'), BlockedPage = op('OwnerSchedule', 'BlockedPage');
const OwnerBookings = op('OwnerMoney', 'BookingsPage'), PaymentsPage = op('OwnerMoney', 'PaymentsPage'), RefundsPage = op('OwnerMoney', 'RefundsPage'), AnalyticsPage = op('OwnerMoney', 'ReportPaymentsPage');
const BusinessPage = op('OwnerAccount', 'BusinessPage'), BankPage = op('OwnerAccount', 'BankPage'), SecurityPage = op('OwnerAccount', 'SecurityPage'), OwnerProfilePage = op('OwnerAccount', 'OwnerProfilePage');
const OwnerOffersPage = op('OwnerPages', 'OwnerOffersPage'), OwnerReviewsPage = op('OwnerPages', 'OwnerReviewsPage'), OwnerStaffPage = op('OwnerStaff', 'StaffPage'), OwnerCustomersPage = op('OwnerCustomers', 'OwnerCustomersPage'), OwnerPendingPaymentsPage = op('OwnerCustomers', 'OwnerPendingPaymentsPage'),
  OwnerActivityPage = op('OwnerExtras', 'OwnerActivityPage'), OwnerCloseAccountPage = op('OwnerExtras', 'OwnerCloseAccountPage');
const a1 = (name: string) => lazy(() => import('./pages/admin/AdminCore').then((m) => ({ default: (m as any)[name] })));
const AdminApplications = lazy(() => import('./pages/admin/AdminApplications').then((m) => ({ default: m.AdminApplications })));
const AdminProfileChanges = lazy(() => import('./pages/admin/AdminApplications').then((m) => ({ default: m.AdminProfileChanges })));
/** The owner's portal home: while the application waits for approval it is the status page; afterwards the real overview. */
function OwnerHome() { return usePendingApproval() ? <PendingOverview /> : <OverviewPage />; }
const aj = (name: string) => lazy(() => import('./pages/admin/AdminJusgo').then((m) => ({ default: (m as any)[name] })));
const AdminSports = aj('AdminSports'), AdminListingChanges = aj('AdminListingChanges'), AdminAreaApprovals = aj('AdminAreaApprovals'), AdminRevenue = aj('AdminRevenue'), AdminCustomers = aj('AdminCustomers'), AdminReviews = aj('AdminReviews'), AdminWallets = aj('AdminWallets');
const a2 = (name: string) => lazy(() => import('./pages/admin/AdminMore').then((m) => ({ default: (m as any)[name] })));
const AdminDashboard = a1('AdminDashboard'), AdminUsers = a1('AdminUsers'), AdminOwners = a1('AdminOwners'), AdminVenues = a1('AdminVenues'), AdminBookings = a1('AdminBookings');
const AdminPayments = a2('AdminPayments'), AdminRefunds = a2('AdminRefunds'), AdminPayouts = a2('AdminPayouts'), AdminCoupons = a2('AdminCoupons'),
  AdminNotify = a2('AdminNotify'), AdminTickets = a2('AdminTickets'), AdminReports = a2('AdminReports'), AdminSettings = a2('AdminSettings'), AdminTeam = a2('AdminTeam'), AdminAudit = a2('AdminAudit');

function NotFound() {
  const { user } = useAuth();
  return <div className="grid min-h-[60vh] place-items-center text-center"><div><p className="font-display text-8xl font-extrabold text-[rgb(var(--brand-text))]">404</p><p className="mb-4 text-muted">That page is out of bounds.</p><Link className="btn-primary" to={user?.role === 'admin' ? '/admin' : user?.role === 'owner' ? '/owner' : '/'}>Back to play</Link></div></div>;
}

export default function App() {
  const loc = useLocation();
  const nav = useNavigationType();
  // A new page opens at its top (back/forward keep the browser's own position); same-page links like #section are left alone.
  useEffect(() => {
    if (nav === 'POP' || loc.hash) return;
    try { window.scrollTo({ top: 0, left: 0 }); } catch { /* jsdom */ }
  }, [loc.pathname, nav, loc.hash]);
  return (
    <>
    <PaymentCelebrationHost />
    <ErrorBoundary key={loc.pathname}>
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginPage portal="customer" />} />
        <Route path="/register" element={<RegisterPage portal="customer" />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/complete-profile" element={<CompleteProfilePage />} />
        <Route path="/verify-account" element={<VerifyAccountPage />} />
        <Route path="/owner/login" element={<LoginPage portal="owner" />} />
        <Route path="/owner/welcome" element={<OwnerWelcomePage />} />
        <Route path="/owner/register" element={<OwnerRegisterPage />} />
        <Route path="/owner/application" element={<RequireRole role="owner"><ApplicationPage /></RequireRole>} />
        <Route path="/admin/login" element={<LoginPage portal="admin" />} />

        <Route element={<CustomerLayout />}>
          <Route index element={<HomePage />} />
          <Route path="venues" element={<Navigate to="/#book" replace />} />
          <Route path="about" element={<AboutPage />} /><Route path="contact" element={<ContactPage />} /><Route path="help" element={<HelpPage />} />
          <Route path="terms" element={<TermsPage />} /><Route path="privacy" element={<PrivacyPage />} /><Route path="cookies" element={<CookiePage />} /><Route path="owner-agreement" element={<OwnerAgreementPage />} /><Route path="cancellation-policy" element={<CancellationPage />} />
          <Route path="venues/:id" element={<VenueDetailPage />} />
          <Route path="nearby" element={<NearbyPage />} /><Route path="sports" element={<SportsPage />} /><Route path="offers" element={<OffersPage />} />
          <Route path="payments" element={<RequireRole role="customer"><CustomerPaymentsPage /></RequireRole>} />
          <Route path="my-reviews" element={<RequireRole role="customer"><MyReviewsPage /></RequireRole>} /><Route path="settings" element={<RequireRole role="customer"><SettingsPage /></RequireRole>} />
          <Route path="bookings" element={<RequireRole role="customer"><BookingsPage /></RequireRole>} />
          <Route path="bookings/:id" element={<RequireRole role="customer"><BookingDetailPage /></RequireRole>} /><Route path="bookings/:id/receipt" element={<RequireRole role="customer"><ReceiptPage /></RequireRole>} />
          <Route path="favourites" element={<RequireRole role="customer"><FavouritesPage /></RequireRole>} /><Route path="wallet" element={<RequireRole role="customer"><WalletPage /></RequireRole>} />
          <Route path="profile" element={<RequireRole role="customer"><ProfilePage /></RequireRole>} />
          <Route path="notifications" element={<RequireRole role="customer"><NotificationsPage /></RequireRole>} />
          <Route path="support" element={<RequireRole role="customer"><SupportPage /></RequireRole>} />
        </Route>

        <Route path="owner" element={<RequireRole role="owner"><OwnerGate><PortalLayout confirmLogout animatedSidebar groups={ownerGroups} subtitle="Turf Owner Portal" rootLabel="Owner" notificationsPath="/owner/notifications" helpPath="/owner/support" searchPath="/owner/bookings" profileLinks={[{ to: '/owner/account/profile', label: 'My profile' }, { to: '/owner/account/security', label: 'Security settings' }, { to: '/owner/support', label: 'Help & support' }]} /></OwnerGate></RequireRole>}>
          <Route index element={<OwnerHome />} />
          <Route path="venues" element={<OwnerVenuesPage />} /><Route path="venues/:id" element={<VenueEditorPage />} />
          <Route path="areas" element={<AreasPage />} /><Route path="areas/:id" element={<AreaDetailsPage />} /><Route path="media" element={<Navigate to="/owner/venues" replace />} /><Route path="documents" element={<Navigate to="/owner/account/business" replace />} /><Route path="hours" element={<HoursPage />} />
          <Route path="calendar" element={<CalendarPage />} /><Route path="slots" element={<SlotsPage />} /><Route path="blocked" element={<BlockedPage />} />
          <Route path="bookings" element={<OwnerBookings view="all" />} /><Route path="bookings/new" element={<OfflineBookingPage />} /><Route path="bookings/upcoming" element={<OwnerBookings view="upcoming" />} />
          <Route path="bookings/history" element={<OwnerBookings view="history" />} /><Route path="bookings/cancelled" element={<OwnerBookings view="cancelled" />} />
          <Route path="pricing" element={<PricingPage />} /><Route path="offers" element={<OwnerOffersPage />} /><Route path="reports" element={<AnalyticsPage />} />
          <Route path="payments" element={<Navigate to="/owner/reports?tab=payments" replace />} /><Route path="settlements" element={<Navigate to="/owner/payments" replace />} /><Route path="refunds" element={<Navigate to="/owner/reports?tab=payments&status=refunds" replace />} />
          <Route path="notifications" element={<NotificationsPage subtitle="Bookings, venue changes and updates about your account." />} /><Route path="support" element={<SupportPage />} />
          <Route path="announcements" element={<NotificationsPage type="announcement" title="Announcements" emptyTitle="No announcements" />} /><Route path="reviews" element={<OwnerReviewsPage />} /><Route path="customers" element={<OwnerCustomersPage />} /><Route path="pending-payments" element={<Navigate to="/owner/reports?tab=payments&status=pending" replace />} /><Route path="activity" element={<OwnerActivityPage />} /><Route path="delete-account" element={<OwnerCloseAccountPage />} />
          <Route path="account/payouts" element={<OwnerPayoutsPage />} /><Route path="account/profile" element={<OwnerProfilePage />} /><Route path="account/business" element={<BusinessPage />} /><Route path="account/bank" element={<BankPage />} /><Route path="account/staff" element={<OwnerStaffPage />} /><Route path="account/security" element={<SecurityPage />} /><Route path="account/documents" element={<Navigate to="/owner/account/business" replace />} />
          <Route path="earnings" element={<Navigate to="/owner/reports" replace />} /><Route path="profile" element={<Navigate to="/owner/account/business" replace />} />
        </Route>

        <Route path="staff" element={<RequireRole role="staff"><StaffLayout /></RequireRole>}><Route index element={<StaffHome />} /><Route path="bookings" element={<StaffBookings />} /><Route path="dashboard" element={<StaffDashboard />} /><Route path="venues" element={<StaffVenues />} /><Route path="pricing" element={<StaffPricing />} /><Route path="new-booking" element={<StaffNewBooking />} /><Route path="calendar" element={<StaffCalendar />} /><Route path="reports" element={<StaffReports />} /><Route path="profile" element={<StaffProfile />} /></Route>
        <Route path="admin" element={<RequireRole role="admin"><PortalLayout adminTheme groups={adminGroups} subtitle="Admin Portal" notificationsPath="/admin/notifications" /></RequireRole>}>
          <Route index element={<AdminDashboard />} />
          <Route path="venues" element={<AdminVenues />} /><Route path="owners" element={<AdminOwners />} /><Route path="users" element={<AdminUsers />} />
          <Route path="bookings" element={<AdminBookings />} /><Route path="payments" element={<AdminPayments />} /><Route path="refunds" element={<AdminRefunds />} />
          <Route path="payouts" element={<AdminPayouts />} /><Route path="coupons" element={<AdminCoupons />} />
          <Route path="notify" element={<AdminNotify />} /><Route path="notifications" element={<NotificationsPage />} /><Route path="tickets" element={<AdminTickets />} /><Route path="reports" element={<AdminReports />} />
          <Route path="applications" element={<AdminApplications />} /><Route path="sports" element={<AdminSports />} /><Route path="listing-changes" element={<AdminListingChanges />} /><Route path="area-approvals" element={<AdminAreaApprovals />} /><Route path="revenue" element={<AdminRevenue />} /><Route path="customers" element={<AdminCustomers />} /><Route path="reviews" element={<AdminReviews />} /><Route path="wallets" element={<AdminWallets />} /><Route path="profile-changes" element={<AdminProfileChanges />} /><Route path="settings" element={<AdminSettings />} /><Route path="team" element={<AdminTeam />} /><Route path="audit" element={<AdminAudit />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
    </>
  );
}
