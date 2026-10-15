import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from "react-router";
import "./index.css";
import { PageLoading } from "./pages/ui";

// every page is its own chunk; three.js loads only with the first 3D view
const Landing = lazy(() => import("./pages/Landing"));
const DevParser = lazy(() => import("./pages/DevParser"));
const RoombaeLayout = lazy(() => import("./pages/roombae/RoombaeLayout"));
const RoombaeHome = lazy(() => import("./pages/roombae/Home"));
const Listings = lazy(() => import("./pages/roombae/Listings"));
const ListingDetail = lazy(() => import("./pages/roombae/ListingDetail"));
const RoommateFinder = lazy(() => import("./pages/roombae/RoommateFinder"));
const Discover = lazy(() => import("./pages/roombae/Discover"));
const Matches = lazy(() => import("./pages/roombae/Matches"));
const FillRoom = lazy(() => import("./pages/roombae/FillRoom"));
const Apply = lazy(() => import("./pages/roombae/Apply"));
const LeaseHubLayout = lazy(() => import("./pages/leasehub/LeaseHubLayout"));
const Dashboard = lazy(() => import("./pages/leasehub/Dashboard"));
const NewListing = lazy(() => import("./pages/leasehub/NewListing"));
const AgentListing = lazy(() => import("./pages/leasehub/AgentListing"));
const ApplicationView = lazy(() => import("./pages/leasehub/ApplicationView"));
const Demo = lazy(() => import("./pages/demo/Demo"));

/** "/" is the landing page; the old dev page URLs ("/?plan=jvue_3bed&view=top") still open the parser lab. */
function Home() {
  const { search } = useLocation();
  return new URLSearchParams(search).has("plan") ? <Navigate to={`/dev${search}`} replace /> : <Landing />;
}

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/dev", element: <DevParser /> },
  {
    path: "/roombae",
    element: <RoombaeLayout />,
    children: [
      { index: true, element: <RoombaeHome /> },
      { path: "listings", element: <Listings /> },
      { path: "listings/:id", element: <ListingDetail /> },
      { path: "discover", element: <Discover /> },
      { path: "matches", element: <Matches /> },
      { path: "roommates", element: <RoommateFinder /> },
      { path: "fill-room", element: <FillRoom /> },
      { path: "apply/:id", element: <Apply /> },
    ],
  },
  {
    path: "/leasehub",
    element: <LeaseHubLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "listings/new", element: <NewListing /> },
      { path: "listings/:id", element: <AgentListing /> },
      { path: "applications/:id", element: <ApplicationView /> },
    ],
  },
  { path: "/demo", element: <Demo /> },
  { path: "/demo/:step", element: <Demo /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<PageLoading />}>
      <RouterProvider router={router} />
    </Suspense>
  </StrictMode>,
);
