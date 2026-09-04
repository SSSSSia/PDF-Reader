import { Routes, Route, Navigate } from "react-router-dom";
import MainPage from "./components/MainPage";
import ConfigPage from "./components/ConfigPage";
import BilingualPage from "./components/BilingualPage";
import InlinePage from "./components/InlinePage";
import { useConfigStore } from "./stores/configStore";
import Layout from "./components/common/Layout";
import ErrorBoundary from "./components/common/ErrorBoundary";

function App() {
  const { isConfigured } = useConfigStore();

  return (
    <ErrorBoundary>
      <Layout>
        <Routes>
          <Route path="/" element={<MainPage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route
            path="/reader/bilingual"
            element={isConfigured ? <BilingualPage /> : <Navigate to="/config" />}
          />
          <Route
            path="/reader/inline"
            element={isConfigured ? <InlinePage /> : <Navigate to="/config" />}
          />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </ErrorBoundary>
  );
}

export default App;
