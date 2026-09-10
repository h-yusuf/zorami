import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import Overview from "./pages/Overview";
import Agents from "./pages/Agents";
import Providers from "./pages/Providers";
import Devices from "./pages/Devices";
import LiveMonitor from "./pages/LiveMonitor";
import Conversations from "./pages/Conversations";
import UsersRoles from "./pages/UsersRoles";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Overview />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/providers" element={<Providers />} />
            <Route path="/devices" element={<Devices />} />
            <Route path="/live-monitor" element={<LiveMonitor />} />
            <Route path="/conversations" element={<Conversations />} />
            <Route path="/users-roles" element={<UsersRoles />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
