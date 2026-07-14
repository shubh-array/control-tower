import { useNavigate, useLocation } from "react-router-dom";
import { Navigate, Route, Routes } from "react-router-dom";
import { FocusQueue } from "./routes/FocusQueue.js";
import { ReviewRoute } from "./routes/ReviewRoute.js";
import { AppShell } from "./components/AppShell.js";
import { DEFAULT_PAGE, type PrimaryPage } from "./lib/navigation.js";
import { ROUTES } from "./lib/routes.js";
import { type FocusQueueRow } from "./lib/api.js";
import { useAppShellState } from "./hooks/useAppShellState.js";

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const shell = useAppShellState();

  const handleNavigate = (page: PrimaryPage) => {
    navigate(ROUTES[page]);
  };

  const handleOpenReview = (item: FocusQueueRow) => {
    if (!item.jobId) {
      return;
    }
    navigate(ROUTES.review(item.jobId), { state: { item } });
  };

  const headerActive: PrimaryPage = location.pathname.startsWith("/review/")
    ? DEFAULT_PAGE
    : DEFAULT_PAGE;

  return (
    <AppShell
      active={headerActive}
      onNavigate={handleNavigate}
      connection={shell.connection}
      refresh={shell.refresh}
      showUnavailableBanner={shell.showUnavailableBanner}
      showStaleBanner={shell.showStaleBanner}
      isRefreshing={shell.isRefreshing}
      onRefresh={shell.onRefresh}
      onRetryConnection={shell.onRetryConnection}
      onRetryRefresh={shell.onRetryRefresh}
    >
      <Routes>
        <Route path="/" element={<Navigate to={ROUTES.inbox} replace />} />
        <Route
          path={ROUTES.inbox}
          element={<FocusQueue onOpenReview={handleOpenReview} />}
        />
        <Route path="/review/:jobId" element={<ReviewRoute />} />
        <Route path="*" element={<Navigate to={ROUTES.inbox} replace />} />
      </Routes>
    </AppShell>
  );
}
