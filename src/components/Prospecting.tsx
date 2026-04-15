import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  ChevronRight,
  ChevronLeft,
  Target,
  Mail,
  Send,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  MapPin,
  Phone,
  Globe,
  Star,
  Users,
  Facebook,
  Briefcase,
  Zap,
  Edit3,
  Trash2,
  RefreshCw,
  Eye,
  Clock,
  Plus,
} from "@geist-ui/icons";
import { doc, updateDoc, type DocumentData } from "firebase/firestore";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useProspecting } from "../hooks/useApi";
import {
  useFirestoreProspects,
  useFirestoreEmailSequences,
  useFirestoreServices,
  useProspectingCache,
  useBusinessSettings,
  useOutreachStats,
  useFinancialGoals,
  useTerritoryState,
  type FirestoreProspect,
} from "../hooks/useFirestore";
import { firestore, COLLECTIONS } from "../lib/firebase";
import type { User } from "firebase/auth";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type WizardStep = "service" | "search" | "enrich" | "emails" | "send";

const STEPS: { id: WizardStep; label: string; icon: any }[] = [
  { id: "service", label: "Select Service", icon: Briefcase },
  { id: "search", label: "Search Business", icon: Search },
  { id: "enrich", label: "Enrich Profile", icon: Facebook },
  { id: "emails", label: "Draft Emails/DMs", icon: Mail },
  { id: "send", label: "Review & Send", icon: Send },
];

const SALES_LEVELS = [
  { name: "Scout", min: 0, colorHex: "#71717a" },
  { name: "Hustler", min: 3, colorHex: "#60a5fa" },
  { name: "Hunter", min: 8, colorHex: "#a78bfa" },
  { name: "Closer", min: 15, colorHex: "#fbbf24" },
  { name: "Legend", min: 30, colorHex: "#34d399" },
];

const NODE_COLORS: Record<string, string> = {
  new: "#60a5fa",
  enriched: "#a78bfa",
  emailing: "#fbbf24",
  converted: "#34d399",
  lost: "#f87171",
};

const DISCOVER_CATEGORIES = [
  { value: "all", label: "All Businesses" },
  { value: "restaurant", label: "Restaurants" },
  { value: "store", label: "Retail / Shops" },
  { value: "beauty_salon", label: "Salons & Spas" },
  { value: "gym", label: "Fitness" },
  { value: "dentist", label: "Dental" },
  { value: "doctor", label: "Medical" },
  { value: "lawyer", label: "Legal" },
  { value: "real_estate_agency", label: "Real Estate" },
  { value: "car_dealer", label: "Auto" },
  { value: "accounting", label: "Accounting" },
  { value: "veterinary_care", label: "Veterinary" },
  { value: "lodging", label: "Hotels" },
  { value: "cafe", label: "Cafes & Coffee" },
  { value: "bar", label: "Bars & Nightlife" },
  { value: "home_goods_store", label: "Home & Garden" },
  { value: "clothing_store", label: "Clothing" },
  { value: "insurance_agency", label: "Insurance" },
  { value: "plumber", label: "Plumbing" },
  { value: "electrician", label: "Electricians" },
  { value: "roofing_contractor", label: "Roofing" },
  { value: "general_contractor", label: "Contractors" },
  { value: "moving_company", label: "Moving" },
  { value: "pet_store", label: "Pet Services" },
  { value: "church", label: "Churches" },
  { value: "school", label: "Schools" },
  { value: "florist", label: "Florists" },
  { value: "bakery", label: "Bakeries" },
  { value: "car_repair", label: "Auto Repair" },
  { value: "car_wash", label: "Car Wash" },
  { value: "laundry", label: "Laundry / Cleaners" },
  { value: "photography", label: "Photography" },
];

interface ProspectingProps {
  user: User;
}

export default function Prospecting({ user }: ProspectingProps) {
  const [activeStep, setActiveStep] = useState<WizardStep>("service");
  const [showWizard, setShowWizard] = useState(false);
  const [selectedProspectId, setSelectedProspectId] = useState<string | null>(null);

  // Wizard state
  const [selectedService, setSelectedService] = useState<{
    id: string;
    name: string;
    description: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLocation, setSearchLocation] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<any>(null);
  const [facebookUrl, setFacebookUrl] = useState("");
  const [findingFacebook, setFindingFacebook] = useState(false);
  const [enrichedData, setEnrichedData] = useState<{
    profile: any;
    posts: any[];
  } | null>(null);
  const [outreachDrafts, setOutreachDrafts] = useState<
    {
      dayNumber: number;
      emailSubject: string;
      emailBody: string;
      dmBody: string;
    }[]
  >([]);
  const [editingEmail, setEditingEmail] = useState<number | null>(null);
  const [regeneratingDay, setRegeneratingDay] = useState<number | null>(null);
  const [outreachTab, setOutreachTab] = useState<"email" | "dm">("email");
  const [gmailStatus, setGmailStatus] = useState<{
    connected: boolean;
    email: string | null;
  }>({ connected: false, email: null });
  const [sendingDay, setSendingDay] = useState<number | null>(null);
  const [pipelineFilter, setPipelineFilter] = useState<string>("all");
  const [copiedToast, setCopiedToast] = useState<string | null>(null);
  const [hoveredMapNode, setHoveredMapNode] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [nearbyBusinesses, setNearbyBusinesses] = useState<any[]>([]);
  const [nearbyCategory, setNearbyCategory] = useState("all");
  const [discoveringNearby, setDiscoveringNearby] = useState(false);
  const [prospectingCity, setProspectingCity] = useState("");

  // Wizard ref
  const wizardRef = useRef<HTMLDivElement>(null);
  const isGeneratingRef = useRef(false);

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const prospectMarkersRef = useRef<L.CircleMarker[]>([]);
  const nearbyMarkersRef = useRef<L.CircleMarker[]>([]);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const searchCircleRef = useRef<L.Circle | null>(null);

  // Hooks
  const api = useProspecting();
  const cache = useProspectingCache();
  const { settings: bizSettings } = useBusinessSettings();
  const { stats: outreachStats } = useOutreachStats();
  const { activeGoal } = useFinancialGoals();
  const { services } = useFirestoreServices();
  const { territory: savedTerritory, loaded: territoryLoaded, saveTerritory } = useTerritoryState();
  const {
    prospects,
    loading: prospectsLoading,
    addProspect,
    updateProspect,
    deleteProspect,
  } = useFirestoreProspects();
  const {
    emails: savedEmails,
    dms: savedDms,
    loading: sequencesLoading,
    saveEmailSequence,
    updateEmailStatus,
    markOpened,
  } = useFirestoreEmailSequences(selectedProspectId);

  // Check Gmail status on mount
  useEffect(() => {
    api.getGmailStatus().then(setGmailStatus);
  }, []);

  // Check for gmail_connected query param (OAuth redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail_connected") === "true") {
      setGmailStatus({
        connected: true,
        email: params.get("gmail_email") || null,
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Restore saved territory or fall back to geolocation
  useEffect(() => {
    if (!territoryLoaded) return;
    if (savedTerritory.lat && savedTerritory.lng) {
      setUserLocation({ lat: savedTerritory.lat, lng: savedTerritory.lng });
      const city = savedTerritory.city || "";
      setProspectingCity(city);
      lastGeocodedCity.current = city;
      setNearbyCategory(savedTerritory.category || "all");
      setNearbyBusinesses(savedTerritory.businesses || []);
    } else {
      navigator.geolocation?.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setUserLocation({ lat: 33.749, lng: -84.388 })
      );
    }
  }, [territoryLoaded]);

  // Inject Leaflet dark theme styles
  useEffect(() => {
    const id = "leaflet-dark-styles";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      .dark-popup .leaflet-popup-content-wrapper{background:#12121A;border:1px solid #27273A;border-radius:12px;color:#fff;box-shadow:0 4px 20px rgba(0,0,0,.5)}
      .dark-popup .leaflet-popup-tip{background:#12121A}
      .dark-popup .leaflet-popup-close-button{color:#71717a}
      .dark-popup .leaflet-popup-close-button:hover{color:#fff}
      .leaflet-control-zoom a{background:#12121A!important;color:#a1a1aa!important;border-color:#27273A!important}
      .leaflet-control-zoom a:hover{background:#1e1e2e!important;color:#fff!important}
    `;
    document.head.appendChild(style);
  }, []);

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    const map = L.map(mapContainerRef.current, {
      center: [33.749, -84.388],
      zoom: 12,
      zoomControl: false,
      scrollWheelZoom: false,
    });
    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);
    mapInstanceRef.current = map;
    return () => { map.remove(); mapInstanceRef.current = null; };
  }, []);

  // Pan to user location
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !userLocation) return;
    map.setView([userLocation.lat, userLocation.lng], 13);
    if (userMarkerRef.current) userMarkerRef.current.remove();
    userMarkerRef.current = L.circleMarker([userLocation.lat, userLocation.lng], {
      radius: 10, fillColor: "#fbbf24", color: "#f59e0b", weight: 3, opacity: 1, fillOpacity: 0.6,
    }).addTo(map);
    const label = prospectingCity.trim() || "Current location";
    userMarkerRef.current.bindPopup(
      L.popup({ className: "dark-popup" }).setContent(
        `<div style="text-align:center;font-family:system-ui"><b style="font-size:13px">${prospectingCity.trim() ? "Prospecting Area" : "Your HQ"}</b><br><span style="color:#999;font-size:11px">${label}</span></div>`
      )
    );
  }, [userLocation]);

  // Update prospect markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    prospectMarkersRef.current.forEach((m) => m.remove());
    prospectMarkersRef.current = [];
    prospects.forEach((p) => {
      const places = p.googlePlacesData as any;
      if (!places?.lat || !places?.lng) return;
      const color = NODE_COLORS[p.status] || NODE_COLORS.new;
      const marker = L.circleMarker([places.lat, places.lng], {
        radius: 9, fillColor: color, color, weight: 2, opacity: 0.9, fillOpacity: 0.5,
      }).addTo(map);
      marker.bindPopup(
        L.popup({ className: "dark-popup" }).setContent(
          `<div style="font-family:system-ui;min-width:150px"><b style="font-size:13px">${p.businessName}</b><br><span style="color:#888;font-size:11px">${p.category || ""}</span><br><span style="font-size:11px;text-transform:capitalize;color:${color}">${p.status}</span></div>`
        )
      );
      prospectMarkersRef.current.push(marker);
    });
  }, [prospects]);

  // Render nearby business markers (used by both restore and discover)
  const renderNearbyMarkers = useCallback((businesses: any[], map: L.Map) => {
    nearbyMarkersRef.current.forEach((m) => m.remove());
    nearbyMarkersRef.current = [];
    businesses.forEach((biz: any) => {
      if (!biz.lat || !biz.lng) return;
      if (prospects.some((p) => (p.googlePlacesData as any)?.placeId === biz.placeId)) return;
      const marker = L.circleMarker([biz.lat, biz.lng], {
        radius: 6, fillColor: "#6366f1", color: "#818cf8", weight: 1.5, opacity: 0.5, fillOpacity: 0.3,
      }).addTo(map);
      const content = document.createElement("div");
      content.style.cssText = "font-family:system-ui;min-width:200px";

      const escapedName = biz.name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
      const fbSearchUrl = `https://www.facebook.com/search/top/?q=${encodeURIComponent(biz.name)}`;

      const nameRow = `<div style="display:flex;align-items:center;gap:6px"><b style="font-size:13px;flex:1">${biz.name}</b><button onclick="navigator.clipboard.writeText('${escapedName}');this.innerHTML='✓';setTimeout(()=>this.innerHTML='📋',1500)" style="background:none;border:1px solid #333;border-radius:4px;cursor:pointer;padding:2px 4px;font-size:11px;color:#999;line-height:1" title="Copy name">📋</button></div>`;
      const categoryLabel = biz.category ? `<span style="display:inline-block;margin-top:4px;padding:2px 8px;border-radius:6px;background:rgba(99,102,241,0.15);color:#a5b4fc;font-size:10px;font-weight:500;text-transform:capitalize">${biz.category}</span>` : "";
      const ratingHtml = biz.rating ? `<div style="margin-top:4px"><span style="font-size:11px;color:#fbbf24">★ ${biz.rating}</span> <span style="font-size:10px;color:#666">(${biz.reviewCount || 0} reviews)</span></div>` : "";
      const addressHtml = biz.address ? `<div style="margin-top:4px;font-size:11px;color:#999">${biz.address}</div>` : "";

      let linksHtml = '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">';
      if (biz.website) {
        linksHtml += `<a href="${biz.website}" target="_blank" rel="noopener" style="font-size:10px;color:#8b5cf6;text-decoration:none;display:flex;align-items:center;gap:3px">🌐 Website</a>`;
      }
      if (biz.mapsUrl) {
        linksHtml += `<a href="${biz.mapsUrl}" target="_blank" rel="noopener" style="font-size:10px;color:#f59e0b;text-decoration:none;display:flex;align-items:center;gap:3px">📍 Google Maps</a>`;
      }
      linksHtml += `<a href="${fbSearchUrl}" target="_blank" rel="noopener" style="font-size:10px;color:#3b82f6;text-decoration:none;display:flex;align-items:center;gap:3px">📘 Facebook</a>`;
      linksHtml += "</div>";

      content.innerHTML = `${nameRow}${categoryLabel}${ratingHtml}${addressHtml}${linksHtml}`;

      const btn = document.createElement("button");
      btn.textContent = "Start Prospecting →";
      btn.style.cssText = "margin-top:8px;padding:6px 12px;border-radius:8px;background:linear-gradient(90deg,#9333ea,#7c3aed);color:white;font-size:11px;border:none;cursor:pointer;width:100%;font-weight:500";
      btn.onclick = () => {
        setSelectedPlace({ ...biz, mapsUrl: biz.mapsUrl || "" });
        setSearchQuery(biz.name);
        setSearchLocation(biz.address);
        setSearchResults([biz]);
        setShowWizard(true);
        setActiveStep("service");
        setTimeout(() => wizardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      };
      content.appendChild(btn);
      marker.bindPopup(L.popup({ className: "dark-popup" }).setContent(content));
      nearbyMarkersRef.current.push(marker);
    });
  }, [prospects]);

  // Restore cached nearby markers on the map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || nearbyBusinesses.length === 0) return;
    renderNearbyMarkers(nearbyBusinesses, map);
  }, [nearbyBusinesses, renderNearbyMarkers]);

  // Geocode a city name → { lat, lng } or null
  const geocodeCity = useCallback(async (cityName: string): Promise<{ lat: number; lng: number } | null> => {
    if (!cityName.trim()) return null;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName.trim())}&format=json&limit=1`,
        { headers: { Accept: "application/json" } }
      );
      const data = await res.json();
      if (!data.length) return null;
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    } catch {
      return null;
    }
  }, []);

  // Move map to a given point and update the HQ marker
  const panMapTo = useCallback((coords: { lat: number; lng: number }, label: string) => {
    setUserLocation(coords);
    const map = mapInstanceRef.current;
    if (!map) return;
    map.setView([coords.lat, coords.lng], 13);
    if (userMarkerRef.current) userMarkerRef.current.remove();
    userMarkerRef.current = L.circleMarker([coords.lat, coords.lng], {
      radius: 10, fillColor: "#fbbf24", color: "#f59e0b", weight: 3, opacity: 1, fillOpacity: 0.6,
    }).addTo(map);
    userMarkerRef.current.bindPopup(
      L.popup({ className: "dark-popup" }).setContent(
        `<div style="text-align:center;font-family:system-ui"><b style="font-size:13px">Prospecting Area</b><br><span style="color:#999;font-size:11px">${label}</span></div>`
      )
    );
  }, []);

  // City search — just move the map, clear old results
  const lastGeocodedCity = useRef("");
  const handleCitySearch = useCallback(async () => {
    const city = prospectingCity.trim();
    if (!city) return;
    const coords = await geocodeCity(city);
    if (!coords) return;
    lastGeocodedCity.current = city;
    panMapTo(coords, city);
    nearbyMarkersRef.current.forEach((m) => m.remove());
    nearbyMarkersRef.current = [];
    if (searchCircleRef.current) searchCircleRef.current.remove();
    setNearbyBusinesses([]);
    saveTerritory({ city, lat: coords.lat, lng: coords.lng, businesses: [] });
  }, [prospectingCity, geocodeCity, panMapTo, saveTerritory]);

  // Nearby business discovery handler
  const handleDiscoverNearby = useCallback(async () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    setDiscoveringNearby(true);

    // If a city is typed but hasn't been geocoded yet, do it now
    const city = prospectingCity.trim();
    if (city && city !== lastGeocodedCity.current) {
      const coords = await geocodeCity(city);
      if (coords) {
        lastGeocodedCity.current = city;
        panMapTo(coords, city);
      }
    }

    const center = map.getCenter();
    const typeParam = nearbyCategory === "all" ? undefined : nearbyCategory;
    const results = await api.searchNearby(center.lat, center.lng, 5000, typeParam);
    setNearbyBusinesses(results);
    if (searchCircleRef.current) searchCircleRef.current.remove();
    searchCircleRef.current = L.circle([center.lat, center.lng], {
      radius: 5000, color: "#8b5cf6", fillColor: "#8b5cf6", fillOpacity: 0.03, weight: 1, dashArray: "5 5",
    }).addTo(map);
    renderNearbyMarkers(results, map);
    saveTerritory({
      city,
      lat: center.lat,
      lng: center.lng,
      category: nearbyCategory,
      businesses: results,
    });
    setDiscoveringNearby(false);
  }, [prospectingCity, nearbyCategory, api, geocodeCity, panMapTo, renderNearbyMarkers, saveTerritory]);

  const stepIndex = STEPS.findIndex((s) => s.id === activeStep);

  const resetWizard = () => {
    setSelectedService(null);
    setSearchQuery("");
    setSearchLocation("");
    setSearchResults([]);
    setSelectedPlace(null);
    setFacebookUrl("");
    setFindingFacebook(false);
    setEnrichedData(null);
    setOutreachDrafts([]);
    setEditingEmail(null);
    setOutreachTab("email");
    setActiveStep("service");
    setShowWizard(false);
    setSelectedProspectId(null);
  };

  // ─── Step 1: Service Selection ─────────────────────────

  const renderServiceStep = () => (
    <div>
      <h3 className="text-lg font-medium text-white mb-2">
        Which service are you prospecting for?
      </h3>
      <p className="text-sm text-zinc-500 mb-6">
        Select the service you want to pitch to potential clients.
      </p>

      {services.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <Briefcase size={32} className="mx-auto mb-3 text-zinc-600" />
          <p className="text-sm">
            No services found. Add services to your catalog first.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {services.map((svc) => (
            <button
              key={svc.id}
              onClick={() => {
                setSelectedService({
                  id: svc.id,
                  name: svc.name,
                  description: svc.description || "",
                });
                setActiveStep("search");
              }}
              className={`p-5 rounded-2xl border text-left transition-all group ${
                selectedService?.id === svc.id
                  ? "border-purple-500/50 bg-purple-500/10"
                  : "border-[#27273A] bg-[#0A0A0F] hover:border-purple-500/30"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600/20 to-purple-400/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                  <Briefcase
                    size={16}
                    className="text-purple-400"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-white mb-1">
                    {svc.name}
                  </h4>
                  <p className="text-xs text-zinc-500 line-clamp-2">
                    {svc.description || "No description"}
                  </p>
                  {svc.margin && (
                    <span className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {svc.margin}% margin
                    </span>
                  )}
                </div>
                <ChevronRight
                  size={14}
                  className="text-zinc-600 mt-1 group-hover:text-purple-400 transition-colors shrink-0"
                />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // ─── Step 2: Business Search ───────────────────────────

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    const queryKey = `${searchQuery.trim().toLowerCase()}|${searchLocation.trim().toLowerCase()}`;
    const cached = await cache.getCachedSearch(queryKey);
    if (cached) {
      setSearchResults(cached);
      return;
    }
    const results = await api.searchBusiness(searchQuery, searchLocation);
    if (results.length > 0) {
      cache.setCachedSearch(queryKey, results);
    }
    setSearchResults(results);
  };

  const renderSearchStep = () => (
    <div>
      <h3 className="text-lg font-medium text-white mb-2">
        Find a business to prospect
      </h3>
      <p className="text-sm text-zinc-500 mb-6">
        Search by business name. We'll use Google Maps to find their details.
      </p>

      <div className="flex gap-3 mb-6">
        <div className="flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Business name (e.g., Blue Bottle Coffee)"
            className="w-full px-4 py-3 rounded-xl bg-[#0A0A0F] border border-[#27273A] text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-purple-500/50 transition-colors"
          />
        </div>
        <div className="w-48">
          <input
            type="text"
            value={searchLocation}
            onChange={(e) => setSearchLocation(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="City or ZIP"
            className="w-full px-4 py-3 rounded-xl bg-[#0A0A0F] border border-[#27273A] text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-purple-500/50 transition-colors"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={api.loading || !searchQuery.trim()}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-white text-sm font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-50 flex items-center gap-2"
        >
          {api.loading ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Search size={14} />
          )}
          Search
        </button>
      </div>

      {api.error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} />
          {api.error}
        </div>
      )}

      {searchResults.length > 0 && (
        <div className="space-y-2">
          {searchResults.map((place: any, i: number) => (
            <button
              key={i}
              onClick={async () => {
                setSelectedPlace(place);
                setActiveStep("enrich");
                setFindingFacebook(true);
                setFacebookUrl("");
                setEnrichedData(null);

                const businessKey = `${place.name}|${place.address}`.toLowerCase();
                const cachedFbUrl = await cache.getCachedFacebookUrl(businessKey);

                let fbUrl = cachedFbUrl;
                if (!fbUrl) {
                  fbUrl = await api.findFacebookUrl(place.name, place.address);
                }

                if (fbUrl) {
                  setFacebookUrl(fbUrl);
                  const cachedEnrichment = await cache.getCachedEnrichment(fbUrl);
                  if (cachedEnrichment) {
                    setEnrichedData(cachedEnrichment);
                  } else {
                    const data = await api.enrichFacebook(fbUrl);
                    if (data) {
                      setEnrichedData(data);
                      cache.setCachedEnrichment(fbUrl, data.profile, data.posts);
                    }
                  }
                }
                setFindingFacebook(false);
              }}
              className={`w-full p-4 rounded-2xl border text-left transition-all group ${
                selectedPlace === place
                  ? "border-purple-500/50 bg-purple-500/10"
                  : "border-[#27273A] bg-[#0A0A0F] hover:border-purple-500/30"
              }`}
            >
              <div className="flex items-start gap-4">
                {place.thumbnail ? (
                  <img
                    src={place.thumbnail}
                    alt=""
                    className="w-16 h-16 rounded-xl object-cover border border-[#27273A] shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-[#12121A] border border-[#27273A] flex items-center justify-center shrink-0">
                    <MapPin size={20} className="text-zinc-600" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-white mb-1">
                    {place.name}
                  </h4>
                  <p className="text-xs text-zinc-500 mb-1 flex items-center gap-1">
                    <MapPin size={10} />
                    {place.address}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    {place.rating && (
                      <span className="flex items-center gap-1">
                        <Star size={10} className="text-amber-400" />
                        {place.rating}
                        {place.reviewCount &&
                          ` (${place.reviewCount})`}
                      </span>
                    )}
                    {place.category && (
                      <span className="px-2 py-0.5 rounded bg-[#27273A] text-zinc-400">
                        {place.category}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight
                  size={14}
                  className="text-zinc-600 mt-2 group-hover:text-purple-400 transition-colors shrink-0"
                />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // ─── Step 3: Facebook Enrichment ───────────────────────

  const handleEnrich = async () => {
    if (!facebookUrl.trim()) return;
    const url = facebookUrl.trim();
    const cached = await cache.getCachedEnrichment(url);
    if (cached) {
      setEnrichedData(cached);
      return;
    }
    const data = await api.enrichFacebook(url);
    if (data) {
      setEnrichedData(data);
      cache.setCachedEnrichment(url, data.profile, data.posts);
    }
  };

  const renderEnrichStep = () => (
    <div>
      <h3 className="text-lg font-medium text-white mb-2">
        Enrich with Facebook data
      </h3>
      <p className="text-sm text-zinc-500 mb-6">
        {findingFacebook
          ? "Automatically finding the Facebook page..."
          : facebookUrl && enrichedData
            ? "Facebook page found and enriched."
            : facebookUrl && !enrichedData
              ? "Facebook page found. Click Enrich to pull data."
              : "Couldn't auto-detect the Facebook page. Enter the URL manually below."}
      </p>

      {selectedPlace && (
        <div className="mb-6 p-4 rounded-2xl bg-[#0A0A0F] border border-[#27273A]">
          <div className="flex items-center gap-3 mb-2">
            <MapPin size={14} className="text-purple-400" />
            <span className="text-sm font-medium text-white">
              {selectedPlace.name}
            </span>
          </div>
          <p className="text-xs text-zinc-500 ml-[26px]">
            {selectedPlace.address}
          </p>
        </div>
      )}

      {findingFacebook && (
        <div className="mb-6 flex items-center gap-3 p-4 rounded-2xl bg-purple-500/5 border border-purple-500/20">
          <RefreshCw size={14} className="text-purple-400 animate-spin" />
          <span className="text-sm text-purple-300">
            Searching for Facebook page and pulling data...
          </span>
        </div>
      )}

      {!findingFacebook && (
        <div className="flex gap-3 mb-6">
          <input
            type="text"
            value={facebookUrl}
            onChange={(e) => setFacebookUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleEnrich()}
            placeholder="https://www.facebook.com/businesspage"
            className="flex-1 px-4 py-3 rounded-xl bg-[#0A0A0F] border border-[#27273A] text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-purple-500/50 transition-colors"
          />
          <button
            onClick={handleEnrich}
            disabled={api.loading || !facebookUrl.trim()}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-white text-sm font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-50 flex items-center gap-2"
          >
            {api.loading ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Zap size={14} />
            )}
            {enrichedData ? "Re-enrich" : "Enrich"}
          </button>
        </div>
      )}

      {api.error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} />
          {api.error}
        </div>
      )}

      {enrichedData && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Profile Card */}
          <div className="rounded-2xl border border-purple-500/20 bg-[#0A0A0F] overflow-hidden mb-4">
            {enrichedData.profile.coverPhoto && (
              <div className="h-32 overflow-hidden">
                <img
                  src={enrichedData.profile.coverPhoto}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="p-5">
              <div className="flex items-start gap-4">
                {enrichedData.profile.profilePic && (
                  <img
                    src={enrichedData.profile.profilePic}
                    alt=""
                    className="w-14 h-14 rounded-full border-2 border-[#27273A] -mt-10 relative z-10 bg-[#0A0A0F]"
                  />
                )}
                <div className="flex-1">
                  <h4 className="text-base font-medium text-white">
                    {enrichedData.profile.name}
                  </h4>
                  <p className="text-xs text-zinc-500">
                    {enrichedData.profile.category}
                  </p>
                  {enrichedData.profile.pageIntro && (
                    <p className="text-sm text-zinc-400 mt-1">
                      {enrichedData.profile.pageIntro}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4">
                {enrichedData.profile.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail size={12} className="text-purple-400" />
                    <span className="text-emerald-400 font-medium">
                      {enrichedData.profile.email}
                    </span>
                  </div>
                )}
                {enrichedData.profile.phone && (
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Phone size={12} className="text-zinc-500" />
                    {enrichedData.profile.phone}
                  </div>
                )}
                {enrichedData.profile.website && (
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Globe size={12} className="text-zinc-500" />
                    <a
                      href={enrichedData.profile.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-purple-400 transition-colors truncate"
                    >
                      {enrichedData.profile.website}
                    </a>
                  </div>
                )}
                {enrichedData.profile.address && (
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <MapPin size={12} className="text-zinc-500" />
                    <span className="truncate">
                      {enrichedData.profile.address}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4 mt-4 pt-3 border-t border-[#27273A]">
                <span className="text-xs text-zinc-500">
                  <Users size={10} className="inline mr-1" />
                  {enrichedData.profile.followerCount?.toLocaleString()}{" "}
                  followers
                </span>
                <span className="text-xs text-zinc-500">
                  {enrichedData.profile.likeCount?.toLocaleString()} likes
                </span>
              </div>
            </div>
          </div>

          {/* Recent Posts */}
          {enrichedData.posts.length > 0 && (
            <div className="rounded-2xl border border-[#27273A] bg-[#0A0A0F] p-5">
              <h4 className="text-sm font-medium text-white mb-3">
                Recent Facebook Posts
              </h4>
              <div className="space-y-3">
                {enrichedData.posts.map((post: any, i: number) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-[#12121A] border border-[#27273A] text-sm text-zinc-400"
                  >
                    <p className="line-clamp-3">{post.text || "(media post)"}</p>
                    {post.date && (
                      <p className="text-[10px] text-zinc-600 mt-2">
                        {post.date}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prospect Insights */}
          {(() => {
            const insights: { icon: string; text: string; type: "warn" | "info" | "good" }[] = [];
            const website = enrichedData?.profile?.website || (selectedPlace as any)?.website || "";
            if (!website) insights.push({ icon: "⚠", text: "No website listed on Google", type: "warn" });
            const posts = enrichedData?.posts || [];
            if (posts.length > 0) {
              const newest = posts[0];
              const postDate = new Date(newest.date);
              if (!isNaN(postDate.getTime())) {
                const daysAgo = Math.floor((Date.now() - postDate.getTime()) / 86400000);
                if (daysAgo > 60) {
                  const months = Math.floor(daysAgo / 30);
                  insights.push({ icon: "⚠", text: `Last Facebook post: ${months} month${months === 1 ? "" : "s"} ago`, type: "warn" });
                } else if (daysAgo <= 14) {
                  insights.push({ icon: "✓", text: "Facebook page is actively posting", type: "good" });
                }
              }
            } else if (enrichedData) {
              insights.push({ icon: "⚠", text: "No Facebook posts found", type: "warn" });
            }
            const rating = (selectedPlace as any)?.rating;
            const reviews = (selectedPlace as any)?.reviewCount;
            if (rating != null && reviews != null) {
              insights.push({ icon: "★", text: `${rating} stars (${reviews} reviews) on Google`, type: rating >= 4 ? "good" : "info" });
            }
            if (bizSettings.agencyLat && bizSettings.agencyLng && (selectedPlace as any)?.lat && (selectedPlace as any)?.lng) {
              const R = 3958.8;
              const dLat = (((selectedPlace as any).lat - bizSettings.agencyLat) * Math.PI) / 180;
              const dLng = (((selectedPlace as any).lng - bizSettings.agencyLng) * Math.PI) / 180;
              const a = Math.sin(dLat / 2) ** 2 + Math.cos((bizSettings.agencyLat * Math.PI) / 180) * Math.cos(((selectedPlace as any).lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
              const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
              if (dist <= bizSettings.localRadiusMiles) {
                insights.push({ icon: "📍", text: `${dist} miles away — you're local`, type: "good" });
              } else {
                insights.push({ icon: "📍", text: `${dist} miles away`, type: "info" });
              }
            }
            if (insights.length === 0) return null;
            return (
              <div className="mt-4 rounded-2xl border border-[#27273A] bg-[#0A0A0F] p-4">
                <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Prospect Insights</h4>
                <div className="space-y-2">
                  {insights.map((ins, i) => (
                    <div key={i} className={`flex items-center gap-2 text-sm ${ins.type === "warn" ? "text-amber-400" : ins.type === "good" ? "text-emerald-400" : "text-zinc-400"}`}>
                      <span className="text-xs">{ins.icon}</span>
                      {ins.text}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-600 mt-3">The AI will use these to craft your outreach messages.</p>
              </div>
            );
          })()}

          {!selectedService && (
            <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm flex items-center gap-2">
              <AlertTriangle size={14} />
              Please select a service first — go back to the Select Service step.
            </div>
          )}

          <div className="flex justify-end mt-4">
            <button
              onClick={async () => {
                if (!enrichedData || !selectedService) return;
                try {
                  if (!selectedProspectId) {
                    const prospect = await addProspect({
                      serviceId: selectedService.id,
                      serviceName: selectedService.name,
                      businessName:
                        enrichedData.profile.name || selectedPlace?.name || "",
                      googlePlacesData: selectedPlace || null,
                      facebookProfile: enrichedData.profile,
                      facebookPosts: enrichedData.posts,
                      email: enrichedData.profile.email || "",
                      phone: enrichedData.profile.phone || "",
                      website: enrichedData.profile.website || "",
                      address: enrichedData.profile.address || "",
                      category: enrichedData.profile.category || "",
                      status: "enriched",
                      lastAction: null,
                      lastActionAt: null,
                    });
                    setSelectedProspectId(prospect.id);
                  }
                  setActiveStep("emails");
                } catch (err: any) {
                  console.error("Failed to save prospect:", err);
                }
              }}
              disabled={!enrichedData || !selectedService}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-white text-sm font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              Generate Emails & DMs
              <ChevronRight size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );

  // ─── Step 4: Email/DM Drafting ─────────────────────────

  const getProspectPayload = () => ({
    businessName: enrichedData?.profile?.name || selectedPlace?.name || "",
    email: enrichedData?.profile?.email || "",
    category: enrichedData?.profile?.category || selectedPlace?.category || "",
    address: enrichedData?.profile?.address || selectedPlace?.address || "",
    website: enrichedData?.profile?.website || selectedPlace?.website || "",
    pageIntro: enrichedData?.profile?.pageIntro || "",
    recentPosts: (enrichedData?.posts || [])
      .filter((p: any) => p.text)
      .slice(0, 5)
      .map((p: any) => ({ text: p.text, date: p.date || "" })),
    googleRating: (selectedPlace as any)?.rating ?? null,
    googleReviewCount: (selectedPlace as any)?.reviewCount ?? null,
    followerCount: enrichedData?.profile?.followerCount || 0,
    prospectLat: (selectedPlace as any)?.lat ?? null,
    prospectLng: (selectedPlace as any)?.lng ?? null,
  });

  const getSenderContext = () => ({
    userName: user.displayName || user.email?.split("@")[0] || "",
    userEmail: user.email || "",
    agencyName: bizSettings.agencyName,
    agencyDescription: bizSettings.agencyDescription,
    agencyWebsite: bizSettings.agencyWebsite,
    agencyEmail: bizSettings.agencyEmail,
    agencyPhone: bizSettings.agencyPhone,
    ownerName: bizSettings.ownerName,
    ownerTitle: bizSettings.ownerTitle,
    brandVoice: bizSettings.brandVoice,
    valuePropositions: bizSettings.valuePropositions,
    caseStudies: bizSettings.caseStudies,
    signOffName: bizSettings.signOffName,
    agencyLat: bizSettings.agencyLat,
    agencyLng: bizSettings.agencyLng,
    localRadiusMiles: bizSettings.localRadiusMiles,
  });

  const handleDraftOutreach = async (forceRegenerate = false) => {
    if (!enrichedData || !selectedService) return;
    if (!forceRegenerate && isGeneratingRef.current) return;
    isGeneratingRef.current = true;

    try {
      const drafts = await api.draftOutreach(
        getProspectPayload(),
        selectedService.name,
        selectedService.description,
        getSenderContext()
      );
      if (drafts.length > 0) {
        setOutreachDrafts(drafts);
        if (selectedProspectId) {
          await saveEmailSequence(selectedProspectId, drafts);
        }
      }
    } catch (err: any) {
      console.error("Draft outreach failed:", err);
    } finally {
      isGeneratingRef.current = false;
    }
  };

  const handleRegenerateSingle = async (dayNumber: number) => {
    if (!enrichedData || !selectedService) return;
    setRegeneratingDay(dayNumber);

    const drafts = await api.draftOutreach(
      getProspectPayload(),
      selectedService.name,
      selectedService.description,
      getSenderContext()
    );

    const newDay = drafts.find((d) => d.dayNumber === dayNumber);
    if (newDay) {
      const updated = outreachDrafts.map((d) =>
        d.dayNumber === dayNumber ? newDay : d
      );
      setOutreachDrafts(updated);

      if (selectedProspectId) {
        const emailDoc = savedEmails.find((e) => e.dayNumber === dayNumber);
        const dmDoc = savedDms.find((d) => d.dayNumber === dayNumber);
        if (emailDoc) {
          await updateDoc(
            doc(firestore, COLLECTIONS.emailSequences, emailDoc.id),
            { subject: newDay.emailSubject, body: newDay.emailBody } as DocumentData
          );
        }
        if (dmDoc) {
          await updateDoc(
            doc(firestore, COLLECTIONS.emailSequences, dmDoc.id),
            { body: newDay.dmBody } as DocumentData
          );
        }
      }
    }
    setRegeneratingDay(null);
  };

  // Restore saved sequences from Firestore or generate for the first time
  useEffect(() => {
    if (activeStep !== "emails" || sequencesLoading) return;

    if (savedEmails.length > 0 && outreachDrafts.length === 0) {
      const restored = savedEmails.map((email) => {
        const matchingDm = savedDms.find(
          (dm) => dm.dayNumber === email.dayNumber
        );
        return {
          dayNumber: email.dayNumber,
          emailSubject: email.subject,
          emailBody: email.body,
          dmBody: matchingDm?.body || "",
        };
      });
      if (restored.length > 0) setOutreachDrafts(restored);
      return;
    }

    if (
      savedEmails.length === 0 &&
      outreachDrafts.length === 0 &&
      enrichedData &&
      !isGeneratingRef.current
    ) {
      handleDraftOutreach();
    }
  }, [activeStep, sequencesLoading, savedEmails.length]);

  const dayLabels = [
    "Introduction",
    "Follow-up",
    "Final Touch",
  ];

  const renderEmailsStep = () => (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-medium text-white mb-1">
            Outreach Sequence
          </h3>
          <p className="text-sm text-zinc-500">
            AI-generated outreach for email and social DMs. Click to edit.
          </p>
        </div>
        <button
          onClick={() => {
            if (window.confirm("Regenerate all messages? This will overwrite your current drafts.")) {
              handleDraftOutreach(true);
            }
          }}
          disabled={api.loading}
          className="px-4 py-2 rounded-xl bg-[#0A0A0F] border border-[#27273A] text-zinc-300 text-xs font-medium hover:border-red-500/40 hover:text-red-400 transition-colors flex items-center gap-2"
        >
          <RefreshCw
            size={12}
            className={api.loading && regeneratingDay === null ? "animate-spin" : ""}
          />
          Regenerate All
        </button>
      </div>

      {/* Email / DM Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#0A0A0F] border border-[#27273A] mb-6 w-fit">
        <button
          onClick={() => setOutreachTab("email")}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            outreachTab === "email"
              ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Mail size={12} className="inline mr-1.5" />
          Emails
        </button>
        <button
          onClick={() => setOutreachTab("dm")}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            outreachTab === "dm"
              ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Send size={12} className="inline mr-1.5" />
          DMs
        </button>
      </div>

      {api.error && outreachDrafts.length === 0 && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} />
          Failed to generate drafts: {api.error}. Try clicking "Regenerate All" above.
        </div>
      )}

      {api.loading && outreachDrafts.length === 0 ? (
        <div className="text-center py-16">
          <RefreshCw
            size={24}
            className="mx-auto mb-3 text-purple-400 animate-spin"
          />
          <p className="text-sm text-zinc-500">
            AI is crafting your emails & DMs...
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {outreachDrafts.map((draft, i) => (
            <motion.div
              key={`${outreachTab}-${draft.dayNumber}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="rounded-2xl border border-[#27273A] bg-[#0A0A0F] overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-3 border-b border-[#27273A]">
                <div className="flex items-center gap-3">
                  <span
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                      draft.dayNumber === 3
                        ? "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                        : outreachTab === "dm"
                          ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                          : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                    }`}
                  >
                    D{draft.dayNumber}
                  </span>
                  <div>
                    <span className="text-xs text-zinc-500">
                      Day {draft.dayNumber} —{" "}
                      {dayLabels[draft.dayNumber - 1] || "Follow-up"}
                    </span>
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[#27273A] text-zinc-400">
                      {outreachTab === "email" ? "Email" : "DM"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleRegenerateSingle(draft.dayNumber)}
                    disabled={regeneratingDay === draft.dayNumber || api.loading}
                    className="text-xs text-zinc-500 hover:text-amber-400 transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw
                      size={12}
                      className={regeneratingDay === draft.dayNumber ? "animate-spin" : ""}
                    />
                    {regeneratingDay === draft.dayNumber ? "..." : "Regen"}
                  </button>
                  <button
                    onClick={() =>
                      setEditingEmail(
                        editingEmail === draft.dayNumber ? null : draft.dayNumber
                      )
                    }
                    className="text-xs text-zinc-500 hover:text-purple-400 transition-colors flex items-center gap-1"
                  >
                    <Edit3 size={12} />
                    {editingEmail === draft.dayNumber ? "Done" : "Edit"}
                  </button>
                </div>
              </div>

              <div className="p-5">
                {outreachTab === "email" ? (
                  editingEmail === draft.dayNumber ? (
                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">
                          Subject
                        </label>
                        <input
                          type="text"
                          value={draft.emailSubject}
                          onChange={(e) => {
                            const updated = [...outreachDrafts];
                            updated[i] = {
                              ...updated[i],
                              emailSubject: e.target.value,
                            };
                            setOutreachDrafts(updated);
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-[#12121A] border border-[#27273A] text-white text-sm focus:outline-none focus:border-purple-500/50"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">
                          Body
                        </label>
                        <textarea
                          value={draft.emailBody}
                          onChange={(e) => {
                            const updated = [...outreachDrafts];
                            updated[i] = {
                              ...updated[i],
                              emailBody: e.target.value,
                            };
                            setOutreachDrafts(updated);
                          }}
                          rows={6}
                          className="w-full px-3 py-2 rounded-lg bg-[#12121A] border border-[#27273A] text-white text-sm focus:outline-none focus:border-purple-500/50 resize-none"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-white mb-2">
                        {draft.emailSubject}
                      </p>
                      <p className="text-sm text-zinc-400 whitespace-pre-wrap leading-relaxed">
                        {draft.emailBody}
                      </p>
                      <div className="mt-4 pt-3 border-t border-[#27273A] flex justify-end">
                        <button
                          onClick={() => {
                            const toEmail = enrichedData?.profile?.email;
                            if (toEmail) openGmailCompose(toEmail, draft.emailSubject, draft.emailBody);
                          }}
                          disabled={!enrichedData?.profile?.email}
                          className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-white text-xs font-medium hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                          <ExternalLink size={12} />
                          Open in Gmail
                        </button>
                      </div>
                    </>
                  )
                ) : editingEmail === draft.dayNumber ? (
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">
                      DM Message
                    </label>
                    <textarea
                      value={draft.dmBody}
                      onChange={(e) => {
                        const updated = [...outreachDrafts];
                        updated[i] = {
                          ...updated[i],
                          dmBody: e.target.value,
                        };
                        setOutreachDrafts(updated);
                      }}
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg bg-[#12121A] border border-[#27273A] text-white text-sm focus:outline-none focus:border-blue-500/50 resize-none"
                    />
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-zinc-400 whitespace-pre-wrap leading-relaxed">
                      {draft.dmBody}
                    </p>
                    <div className="mt-4 pt-3 border-t border-[#27273A] flex justify-end">
                      <button
                        onClick={() => {
                          const fbUrl = enrichedData?.profile?.facebookUrl || facebookUrl;
                          if (fbUrl) openFacebookDm(fbUrl, draft.dmBody);
                        }}
                        disabled={!enrichedData?.profile?.facebookUrl && !facebookUrl}
                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-white text-xs font-medium hover:from-blue-500 hover:to-blue-400 transition-all disabled:opacity-50 flex items-center gap-2"
                      >
                        <ExternalLink size={12} />
                        Open Messenger
                      </button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          ))}

          {outreachDrafts.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={() => setActiveStep("send")}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-white text-sm font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] flex items-center gap-2"
              >
                Continue to Send
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ─── Step 5: Review & Send ─────────────────────────────

  const openGmailCompose = (to: string, subject: string, body: string) => {
    const params = new URLSearchParams({
      view: "cm",
      fs: "1",
      to,
      su: subject,
      body,
    });
    window.open(`https://mail.google.com/mail/?${params.toString()}`, "_blank");
  };

  const openFacebookDm = (facebookUrl: string, dmText: string) => {
    navigator.clipboard.writeText(dmText);
    setCopiedToast("DM copied to clipboard — paste it in Messenger (Cmd+V)");
    setTimeout(() => setCopiedToast(null), 5000);
    let messengerUrl = facebookUrl;
    const match = facebookUrl.match(/facebook\.com\/([^/?#]+)/);
    if (match?.[1]) {
      messengerUrl = `https://m.me/${match[1]}`;
    }
    window.open(messengerUrl, "_blank");
  };

  const handleSendEmail = async (email: {
    id: string;
    subject: string;
    body: string;
    dayNumber: number;
  }) => {
    const toEmail = enrichedData?.profile?.email;
    if (!toEmail) return;

    setSendingDay(email.dayNumber);
    const result = await api.sendEmail(toEmail, email.subject, email.body);
    if (result) {
      await updateEmailStatus(email.id, "sent", new Date().toISOString());
      if (selectedProspectId) {
        await updateProspect(selectedProspectId, { status: "emailing" });
      }
    }
    setSendingDay(null);
  };

  const [sendTab, setSendTab] = useState<"email" | "dm">("email");
  const activeSendList = sendTab === "email" ? savedEmails : savedDms;

  const renderSendStep = () => (
    <div>
      <h3 className="text-lg font-medium text-white mb-2">
        Review & Send
      </h3>
      <p className="text-sm text-zinc-500 mb-6">
        Connect Gmail and send your prospecting emails. Copy DMs to send manually.
      </p>

      {/* Gmail Connection */}
      <div
        className={`p-5 rounded-2xl border mb-6 ${
          gmailStatus.connected
            ? "border-emerald-500/20 bg-emerald-500/5"
            : "border-amber-500/20 bg-amber-500/5"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mail
              size={18}
              className={
                gmailStatus.connected ? "text-emerald-400" : "text-amber-400"
              }
            />
            <div>
              <p className="text-sm font-medium text-white">
                {gmailStatus.connected
                  ? "Gmail Connected"
                  : "Connect Gmail to Send"}
              </p>
              {gmailStatus.email && (
                <p className="text-xs text-zinc-500">{gmailStatus.email}</p>
              )}
            </div>
          </div>
          {!gmailStatus.connected && (
            <button
              onClick={async () => {
                const url = await api.getGmailAuthUrl();
                if (url) window.location.href = url;
              }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-white text-xs font-medium hover:from-purple-500 hover:to-purple-400 transition-all"
            >
              Connect Gmail
            </button>
          )}
          {gmailStatus.connected && (
            <CheckCircle size={18} className="text-emerald-400" />
          )}
        </div>
      </div>

      {/* Recipient info */}
      {enrichedData?.profile?.email && (
        <div className="p-4 rounded-2xl bg-[#0A0A0F] border border-[#27273A] mb-6 flex items-center gap-3">
          <Target size={14} className="text-purple-400" />
          <span className="text-sm text-zinc-400">Sending to:</span>
          <span className="text-sm text-white font-medium">
            {enrichedData.profile.email}
          </span>
          <span className="text-xs text-zinc-600">
            ({enrichedData.profile.name})
          </span>
        </div>
      )}

      {/* Email / DM Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#0A0A0F] border border-[#27273A] mb-6 w-fit">
        <button
          onClick={() => setSendTab("email")}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            sendTab === "email"
              ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Mail size={12} className="inline mr-1.5" />
          Emails ({savedEmails.length})
        </button>
        <button
          onClick={() => setSendTab("dm")}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            sendTab === "dm"
              ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Send size={12} className="inline mr-1.5" />
          DMs ({savedDms.length})
        </button>
      </div>

      {/* Sequence status */}
      <div className="space-y-3">
        {activeSendList.map((item) => (
          <div
            key={item.id}
            className="p-4 rounded-2xl border border-[#27273A] bg-[#0A0A0F] flex items-center justify-between"
          >
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <span
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                  item.status === "sent"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : item.dayNumber === 3
                      ? "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                      : sendTab === "dm"
                        ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                        : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                }`}
              >
                D{item.dayNumber}
              </span>
              <div className="min-w-0">
                {sendTab === "email" && (
                  <p className="text-sm font-medium text-white truncate">
                    {item.subject}
                  </p>
                )}
                <p className="text-xs text-zinc-500 truncate">
                  Day {item.dayNumber} —{" "}
                  {dayLabels[item.dayNumber - 1] || "Follow-up"}
                  {sendTab === "dm" && (
                    <span className="ml-2 text-zinc-600">
                      {item.body.slice(0, 60)}...
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {item.openedAt && (
                <span className="text-[10px] text-zinc-600 flex items-center gap-1 mr-1">
                  <Clock size={10} />
                  Opened via {item.openedVia === "gmail" ? "Gmail" : "Messenger"}{" "}
                  {timeAgo(item.openedAt)}
                </span>
              )}
              {item.status === "sent" ? (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle size={12} /> Sent
                </span>
              ) : sendTab === "email" ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const toEmail = enrichedData?.profile?.email;
                      if (toEmail) {
                        openGmailCompose(toEmail, item.subject, item.body);
                        markOpened(item.id, "gmail");
                        if (selectedProspectId) {
                          updateProspect(selectedProspectId, {
                            status: "emailing",
                            lastAction: `Opened Day ${item.dayNumber} email in Gmail`,
                            lastActionAt: new Date().toISOString(),
                          });
                        }
                      }
                    }}
                    disabled={!enrichedData?.profile?.email}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-white text-xs font-medium hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    <ExternalLink size={12} />
                    {item.openedAt && item.openedVia === "gmail" ? "Reopen Gmail" : "Open in Gmail"}
                  </button>
                  {gmailStatus.connected && (
                    <button
                      onClick={() =>
                        handleSendEmail({
                          id: item.id,
                          subject: item.subject,
                          body: item.body,
                          dayNumber: item.dayNumber,
                        })
                      }
                      disabled={sendingDay === item.dayNumber || !enrichedData?.profile?.email}
                      className="px-4 py-2 rounded-xl bg-[#0A0A0F] border border-[#27273A] text-zinc-300 text-xs font-medium hover:border-purple-500/40 transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {sendingDay === item.dayNumber ? (
                        <RefreshCw size={12} className="animate-spin" />
                      ) : (
                        <Send size={12} />
                      )}
                      Auto-Send
                    </button>
                  )}
                </div>
              ) : sendTab === "dm" ? (
                <button
                  onClick={() => {
                    const fbUrl = enrichedData?.profile?.facebookUrl || facebookUrl;
                    if (fbUrl) {
                      openFacebookDm(fbUrl, item.body);
                      markOpened(item.id, "messenger");
                      if (selectedProspectId) {
                        updateProspect(selectedProspectId, {
                          status: "emailing",
                          lastAction: `Opened Day ${item.dayNumber} DM in Messenger`,
                          lastActionAt: new Date().toISOString(),
                        });
                      }
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-white text-xs font-medium hover:from-blue-500 hover:to-blue-400 transition-all flex items-center gap-2"
                >
                  <ExternalLink size={12} />
                  {item.openedAt && item.openedVia === "messenger" ? "Reopen Messenger" : "Open Messenger"}
                </button>
              ) : (
                <span className="text-xs text-zinc-500 flex items-center gap-1">
                  <Clock size={12} /> Draft
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {savedEmails.length > 0 && enrichedData?.profile?.email && sendTab === "email" && savedEmails.some((e) => e.status !== "sent") && (
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => {
              const toEmail = enrichedData?.profile?.email;
              if (!toEmail) return;
              for (const email of savedEmails) {
                if (email.status !== "sent") {
                  openGmailCompose(toEmail, email.subject, email.body);
                  markOpened(email.id, "gmail");
                }
              }
              if (selectedProspectId) {
                updateProspect(selectedProspectId, { status: "emailing" });
              }
            }}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-sm font-medium hover:from-emerald-500 hover:to-emerald-400 transition-all flex items-center gap-2"
          >
            <ExternalLink size={14} />
            Open All in Gmail
          </button>
        </div>
      )}
    </div>
  );

  // ─── Pipeline Table ────────────────────────────────────

  const filteredProspects =
    pipelineFilter === "all"
      ? prospects
      : prospects.filter((p) => p.status === pipelineFilter);

  const statusColors: Record<string, string> = {
    new: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    enriched: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    emailing: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    converted: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    lost: "bg-red-500/10 text-red-400 border-red-500/20",
  };

  // ─── Gamification & Sales Intelligence ──────────────────

  const totalConverted = prospects.filter((p) => p.status === "converted").length;
  const totalOutreach = outreachStats.emailsSent + outreachStats.dmsSent;
  const totalOpened = outreachStats.emailsOpened + outreachStats.dmsOpened;

  const currentLevelIdx = (() => {
    for (let i = SALES_LEVELS.length - 1; i >= 0; i--) {
      if (totalConverted >= SALES_LEVELS[i].min) return i;
    }
    return 0;
  })();
  const currentLevel = SALES_LEVELS[currentLevelIdx];
  const nextLevel = SALES_LEVELS[currentLevelIdx + 1];
  const xpProgress = nextLevel
    ? Math.min(100, Math.round(((totalConverted - currentLevel.min) / (nextLevel.min - currentLevel.min)) * 100))
    : 100;

  const avgOutreachPerSale = totalConverted > 0 ? Math.ceil(totalOutreach / totalConverted) : 15;
  const nextSaleIn = totalConverted > 0
    ? Math.max(1, avgOutreachPerSale - (totalOutreach % avgOutreachPerSale))
    : Math.max(1, 15 - totalOutreach);

  // Goal-based game plan
  const gamePlan = (() => {
    if (!activeGoal || activeGoal.targetMRR <= 0) return null;
    const totalClientsNeeded = activeGoal.serviceMix.length > 0
      ? activeGoal.serviceMix.reduce((s, m) => s + m.targetClients, 0)
      : Math.ceil(activeGoal.targetMRR / 500);
    const rate = (activeGoal.closeRate || 10) / 100;
    const outreachesNeeded = Math.ceil(totalClientsNeeded / rate);
    const months = Math.max(activeGoal.timeline, 1);
    const weeklyTarget = Math.ceil(outreachesNeeded / (months * 4));
    const dailyTarget = Math.ceil(weeklyTarget / 5);
    const revenuePct = activeGoal.targetMRR > 0
      ? Math.min(100, Math.round((activeGoal.currentMRR / activeGoal.targetMRR) * 100))
      : 0;
    return {
      targetMRR: activeGoal.targetMRR,
      currentMRR: activeGoal.currentMRR,
      totalClientsNeeded,
      outreachesNeeded,
      weeklyTarget,
      dailyTarget,
      closeRate: activeGoal.closeRate,
      salesCycle: activeGoal.avgSalesCycle,
      months,
      revenuePct,
      outreachPct: outreachesNeeded > 0 ? Math.min(100, Math.round((totalOutreach / outreachesNeeded) * 100)) : 0,
      serviceMix: activeGoal.serviceMix,
    };
  })();

  // Performance rates
  const userOpenRate = totalOutreach > 0 ? Math.round((totalOpened / totalOutreach) * 100) : 0;
  const userResponseRate = totalOutreach > 0 ? Math.round((outreachStats.responded / totalOutreach) * 100) : 0;
  const userCloseRate = totalOutreach > 0 ? Math.round((totalConverted / totalOutreach) * 100) : 0;

  const benchmarks = [
    { label: "Outreach / Sale", yours: totalConverted > 0 ? `${avgOutreachPerSale}` : "—", industry: "15-20", good: totalConverted > 0 && avgOutreachPerSale <= 20 },
    { label: "Close Rate", yours: totalOutreach > 0 ? `${userCloseRate}%` : "—", industry: "2-5%", good: userCloseRate >= 2 },
    { label: "Open Rate", yours: totalOutreach > 0 ? `${userOpenRate}%` : "—", industry: "15-25%", good: userOpenRate >= 15 },
    { label: "Response Rate", yours: totalOutreach > 0 ? `${userResponseRate}%` : "—", industry: "5-10%", good: userResponseRate >= 5 },
    { label: "Sales Cycle", yours: gamePlan ? `${gamePlan.salesCycle}d` : "—", industry: "21-45 days", good: gamePlan ? gamePlan.salesCycle <= 45 : false },
  ];

  const funnelCeiling = Math.max(prospects.length, totalOutreach, 1);
  const funnelData = [
    { label: "Prospects", count: prospects.length, pct: (prospects.length / funnelCeiling) * 100, color: "from-blue-600 to-blue-500" },
    { label: "Emails Sent", count: outreachStats.emailsSent, pct: (outreachStats.emailsSent / funnelCeiling) * 100, color: "from-purple-600 to-purple-500" },
    { label: "DMs Sent", count: outreachStats.dmsSent, pct: (outreachStats.dmsSent / funnelCeiling) * 100, color: "from-indigo-600 to-indigo-500" },
    { label: "Opened", count: totalOpened, pct: (totalOpened / funnelCeiling) * 100, color: "from-amber-500 to-amber-400" },
    { label: "Responded", count: outreachStats.responded, pct: (outreachStats.responded / funnelCeiling) * 100, color: "from-orange-500 to-orange-400" },
    { label: "Closed", count: totalConverted, pct: (totalConverted / funnelCeiling) * 100, color: "from-emerald-500 to-emerald-400" },
  ];

  // ─── Main Render ───────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-7xl mx-auto"
    >
      {/* Copied Toast */}
      <AnimatePresence>
        {copiedToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-blue-600 text-white text-sm font-medium shadow-lg shadow-blue-600/30 flex items-center gap-3"
          >
            <CheckCircle size={16} />
            {copiedToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-3xl font-semibold text-white">Prospecting</h2>
            <p className="text-zinc-400 text-sm mt-1">
              Your territory. Your hustle. Every outreach brings you closer.
            </p>
          </div>
          <div
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border"
            style={{
              borderColor: currentLevel.colorHex + "40",
              background: currentLevel.colorHex + "10",
            }}
          >
            <Target size={12} style={{ color: currentLevel.colorHex }} />
            <span
              className="text-xs font-bold"
              style={{ color: currentLevel.colorHex }}
            >
              {currentLevel.name}
            </span>
          </div>
        </div>
        <button
          onClick={() => {
            resetWizard();
            setShowWizard(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)]"
        >
          <Plus size={16} /> New Prospect
        </button>
      </div>

      {/* ═══ GAME PLAN ═══ */}
      {gamePlan ? (
        <div className="mb-8 bg-[#12121A] border border-[#27273A] rounded-3xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#27273A] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600/20 to-indigo-500/20 border border-purple-500/20 flex items-center justify-center">
                <Target size={14} className="text-purple-400" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-white">Your Game Plan</h3>
                <p className="text-[10px] text-zinc-500">Revenue goal → exactly what it takes to get there</p>
              </div>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border"
              style={{ borderColor: currentLevel.colorHex + "40", background: currentLevel.colorHex + "10" }}
            >
              <Target size={12} style={{ color: currentLevel.colorHex }} />
              <span className="text-xs font-bold" style={{ color: currentLevel.colorHex }}>{currentLevel.name}</span>
              {nextLevel && (
                <div className="w-12 h-1.5 bg-[#0A0A0F] rounded-full overflow-hidden ml-1">
                  <motion.div className="h-full rounded-full" style={{ background: currentLevel.colorHex }} initial={{ width: 0 }} animate={{ width: `${xpProgress}%` }} transition={{ duration: 1.5 }} />
                </div>
              )}
            </div>
          </div>

          <div className="p-6">
            {/* Goal flow: Revenue → Clients → Outreaches → Daily */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { label: "Revenue Goal", value: `$${gamePlan.targetMRR.toLocaleString()}`, sub: `/month (${gamePlan.months}mo plan)`, accent: "text-purple-400" },
                { label: "Clients to Close", value: `${gamePlan.totalClientsNeeded}`, sub: `at ${gamePlan.closeRate}% close rate`, accent: "text-blue-400" },
                { label: "Total Outreaches", value: `${gamePlan.outreachesNeeded}`, sub: `needed over ${gamePlan.months} months`, accent: "text-amber-400" },
                { label: "Daily Target", value: `${gamePlan.dailyTarget}`, sub: `(${gamePlan.weeklyTarget}/week)`, accent: "text-emerald-400" },
              ].map((card) => (
                <div key={card.label} className="p-4 rounded-2xl bg-[#0A0A0F] border border-[#27273A]">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">{card.label}</p>
                  <p className={`text-2xl font-bold ${card.accent}`}>{card.value}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">{card.sub}</p>
                </div>
              ))}
            </div>

            {/* Progress bars */}
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-zinc-400">Revenue Progress</span>
                  <span className="text-white font-bold">${gamePlan.currentMRR.toLocaleString()} <span className="text-zinc-600 font-normal">/ ${gamePlan.targetMRR.toLocaleString()}</span></span>
                </div>
                <div className="h-3 bg-[#0A0A0F] rounded-full overflow-hidden">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400" initial={{ width: 0 }} animate={{ width: `${gamePlan.revenuePct}%` }} transition={{ duration: 1.5, ease: "easeOut" }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-zinc-400">Outreach Progress</span>
                  <span className="text-white font-bold">{totalOutreach} <span className="text-zinc-600 font-normal">/ {gamePlan.outreachesNeeded}</span></span>
                </div>
                <div className="h-3 bg-[#0A0A0F] rounded-full overflow-hidden">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400" initial={{ width: 0 }} animate={{ width: `${gamePlan.outreachPct}%` }} transition={{ duration: 1.5, ease: "easeOut", delay: 0.2 }} />
                </div>
              </div>
            </div>

            {/* Service mix breakdown */}
            {gamePlan.serviceMix.length > 0 && (
              <div className="mt-5 pt-4 border-t border-[#27273A]">
                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Service Breakdown</p>
                <div className="space-y-1.5">
                  {gamePlan.serviceMix.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">{s.serviceName} <span className="text-zinc-600">({s.tierName})</span></span>
                      <span className="text-zinc-300">${s.tierPrice.toLocaleString()}/mo × {s.targetClients} clients = <span className="text-white font-bold">${(s.tierPrice * s.targetClients).toLocaleString()}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sales cycle + motivation */}
            <div className="mt-4 pt-4 border-t border-[#27273A] flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <Clock size={12} className="text-zinc-600" />
                <span className="text-xs text-zinc-400">Avg sales cycle: <span className="text-white font-bold">{gamePlan.salesCycle} days</span> <span className="text-zinc-600">(industry: 21-45d)</span></span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-zinc-400"><span className="text-emerald-400 font-bold">{nextSaleIn}</span> more outreaches to your next close</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-8 p-6 bg-[#12121A] border border-dashed border-[#27273A] rounded-3xl text-center">
          <Target size={28} className="mx-auto mb-3 text-zinc-600" />
          <p className="text-sm text-zinc-400 mb-1">No revenue goal set yet</p>
          <p className="text-xs text-zinc-600 mb-4">Set a growth goal in the <span className="text-purple-400">Financials</span> tab to see your personalized game plan here — exactly how many outreaches per day it takes to hit your number.</p>
          <div className="flex items-center justify-center gap-6 text-xs text-zinc-500">
            <span>~<span className="text-amber-400 font-bold">{avgOutreachPerSale}</span> outreaches/sale</span>
            <span><span className="text-emerald-400 font-bold">{nextSaleIn}</span> more to next close</span>
            <span><span className="text-white font-bold">{totalConverted}</span> sales closed</span>
          </div>
        </div>
      )}

      {/* ═══ YOUR NUMBERS vs INDUSTRY ═══ */}
      <div className="mb-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conversion Funnel */}
        <div className="bg-[#12121A] border border-[#27273A] rounded-3xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#27273A] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center">
              <Zap size={14} className="text-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-white">Your Pipeline</h3>
              <p className="text-[10px] text-zinc-500">Every number tells a story</p>
            </div>
          </div>
          <div className="p-6 space-y-2.5">
            {funnelData.map((item, i) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="w-24 text-[11px] text-zinc-500 text-right shrink-0">{item.label}</span>
                <div className="flex-1 h-7 bg-[#0A0A0F] rounded-lg overflow-hidden relative">
                  <motion.div className={`h-full rounded-lg bg-gradient-to-r ${item.color}`} initial={{ width: 0 }} animate={{ width: `${Math.max(item.count > 0 ? 3 : 0, item.pct)}%` }} transition={{ duration: 1, delay: i * 0.1, ease: "easeOut" }} />
                  <span className="absolute inset-0 flex items-center px-3 text-[11px] font-bold text-white drop-shadow-sm">{item.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Industry Benchmarks */}
        <div className="bg-[#12121A] border border-[#27273A] rounded-3xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#27273A] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/20 flex items-center justify-center">
              <Users size={14} className="text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-white">You vs Industry</h3>
              <p className="text-[10px] text-zinc-500">How your numbers stack up against averages</p>
            </div>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-3 gap-0 text-[11px] mb-2 px-1">
              <span className="text-zinc-600 uppercase tracking-wider">Metric</span>
              <span className="text-zinc-600 uppercase tracking-wider text-center">You</span>
              <span className="text-zinc-600 uppercase tracking-wider text-right">Industry Avg</span>
            </div>
            <div className="space-y-1">
              {benchmarks.map((b) => (
                <div key={b.label} className="grid grid-cols-3 gap-0 items-center p-2.5 rounded-xl hover:bg-[#0A0A0F] transition-colors">
                  <span className="text-xs text-zinc-400">{b.label}</span>
                  <span className={`text-sm font-bold text-center ${b.yours === "—" ? "text-zinc-600" : b.good ? "text-emerald-400" : "text-zinc-300"}`}>{b.yours}</span>
                  <span className="text-xs text-zinc-600 text-right">{b.industry}</span>
                </div>
              ))}
            </div>
            {totalOutreach === 0 && (
              <p className="text-[10px] text-zinc-600 text-center mt-4 italic">Start outreaching to see how you compare</p>
            )}
            {totalOutreach > 0 && (
              <div className="mt-4 pt-3 border-t border-[#27273A] text-center">
                <p className="text-[10px] text-zinc-500">
                  {benchmarks.filter((b) => b.good && b.yours !== "—").length >= 3
                    ? "You're outperforming industry averages — keep this pace."
                    : benchmarks.filter((b) => b.good && b.yours !== "—").length >= 1
                      ? "You're on the right track. More reps = better numbers."
                      : "Every rep counts. The numbers will come with consistency."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ TERRITORY MAP ═══ */}
      <div className="mb-8 bg-[#12121A] border border-[#27273A] rounded-3xl shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-[#27273A] flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/20 flex items-center justify-center">
              <MapPin size={14} className="text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-white">Your Territory</h3>
              <p className="text-[10px] text-zinc-500">Discover potential clients in your area — start in your backyard</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={prospectingCity}
                onChange={(e) => setProspectingCity(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCitySearch()}
                placeholder="City (e.g. Dallas, TX)"
                className="px-3 py-1.5 rounded-lg bg-[#0A0A0F] border border-[#27273A] text-zinc-300 text-xs focus:outline-none focus:border-emerald-500/50 w-40 placeholder:text-zinc-600"
              />
              <button
                onClick={handleCitySearch}
                className="p-1.5 rounded-lg bg-[#0A0A0F] border border-[#27273A] text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/40 transition-colors"
                title="Go to city"
              >
                <MapPin size={12} />
              </button>
            </div>
            <div className="w-px h-5 bg-[#27273A]" />
            <select
              value={nearbyCategory}
              onChange={(e) => setNearbyCategory(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[#0A0A0F] border border-[#27273A] text-zinc-300 text-xs focus:outline-none focus:border-purple-500/50"
            >
              {DISCOVER_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
            <button
              onClick={handleDiscoverNearby}
              disabled={discoveringNearby}
              className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-purple-500 text-white text-xs font-medium hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              {discoveringNearby ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
              Discover Nearby
            </button>
          </div>
        </div>
        <div className="relative">
          <div ref={mapContainerRef} className="w-full" style={{ height: "420px" }} />
          {/* Stats overlay */}
          <div className="absolute top-3 left-3 z-[1000] space-y-2">
            <div className="px-3 py-2 rounded-xl bg-[#12121A]/90 border border-[#27273A] backdrop-blur-sm">
              <div className="flex items-center gap-3 text-xs">
                <span className="text-white font-bold">{totalOutreach}</span><span className="text-zinc-600">sent</span>
                <span className="text-amber-400 font-bold">{totalOpened}</span><span className="text-zinc-600">opened</span>
                <span className="text-emerald-400 font-bold">{totalConverted}</span><span className="text-zinc-600">won</span>
              </div>
            </div>
            <div className="px-3 py-2 rounded-xl bg-[#12121A]/90 border border-[#27273A] backdrop-blur-sm">
              <p className="text-xs">
                <span className="text-zinc-500">~</span><span className="text-purple-400 font-bold">{avgOutreachPerSale}</span>
                <span className="text-zinc-500"> outreaches/sale</span>
                <span className="text-zinc-700 mx-1.5">|</span>
                <span className="text-zinc-500">avg: </span><span className="text-zinc-400">15-20</span>
              </p>
            </div>
          </div>
          {/* Legend */}
          <div className="absolute bottom-3 left-3 z-[1000] px-3 py-2 rounded-xl bg-[#12121A]/90 border border-[#27273A] backdrop-blur-sm flex items-center gap-3 text-[10px] text-zinc-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> HQ</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-400" /> New</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-purple-400" /> Enriched</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Emailing</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Won</span>
            {nearbyBusinesses.length > 0 && (
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-indigo-400/50 border border-indigo-400" /> Potential</span>
            )}
          </div>
          {nearbyBusinesses.length > 0 && (
            <div className="absolute bottom-3 right-14 z-[1000] px-3 py-2 rounded-xl bg-[#12121A]/90 border border-purple-500/20 backdrop-blur-sm">
              <p className="text-[10px] text-purple-400"><span className="font-bold">{nearbyBusinesses.length}</span> businesses discovered — click to prospect</p>
            </div>
          )}
        </div>
      </div>

      {/* Wizard */}
      <div ref={wizardRef} />
      <AnimatePresence>
        {showWizard && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-8"
          >
            <div className="bg-[#12121A] border border-[#27273A] rounded-3xl shadow-lg overflow-hidden">
              {/* Step Indicators */}
              <div className="flex items-center border-b border-[#27273A] px-6 py-4">
                {STEPS.map((step, i) => {
                  const StepIcon = step.icon;
                  const isCurrent = step.id === activeStep;
                  const isPast = i < stepIndex;
                  return (
                    <React.Fragment key={step.id}>
                      <button
                        onClick={() => {
                          if (isPast) setActiveStep(step.id);
                        }}
                        disabled={!isPast && !isCurrent}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                          isCurrent
                            ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                            : isPast
                            ? "text-zinc-400 hover:text-purple-400 cursor-pointer"
                            : "text-zinc-600 cursor-default"
                        }`}
                      >
                        {isPast ? (
                          <CheckCircle size={14} className="text-emerald-400" />
                        ) : (
                          <StepIcon size={14} />
                        )}
                        <span className="hidden sm:inline">{step.label}</span>
                      </button>
                      {i < STEPS.length - 1 && (
                        <div
                          className={`flex-1 h-px mx-2 ${
                            i < stepIndex ? "bg-purple-500/30" : "bg-[#27273A]"
                          }`}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
                <button
                  onClick={resetWizard}
                  className="ml-4 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Step Content */}
              <div className="p-6 sm:p-8">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeStep}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                  >
                    {activeStep === "service" && renderServiceStep()}
                    {activeStep === "search" && renderSearchStep()}
                    {activeStep === "enrich" && renderEnrichStep()}
                    {activeStep === "emails" && renderEmailsStep()}
                    {activeStep === "send" && renderSendStep()}
                  </motion.div>
                </AnimatePresence>

                {/* Navigation */}
                {stepIndex > 0 && activeStep !== "service" && (
                  <div className="mt-6 pt-4 border-t border-[#27273A]">
                    <button
                      onClick={() =>
                        setActiveStep(STEPS[stepIndex - 1].id)
                      }
                      className="text-sm text-zinc-500 hover:text-purple-400 transition-colors flex items-center gap-1"
                    >
                      <ChevronLeft size={14} />
                      Back to {STEPS[stepIndex - 1].label}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pipeline Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {(
          [
            { label: "All", value: "all", count: prospects.length },
            {
              label: "New",
              value: "new",
              count: prospects.filter((p) => p.status === "new").length,
            },
            {
              label: "Enriched",
              value: "enriched",
              count: prospects.filter((p) => p.status === "enriched").length,
            },
            {
              label: "Emailing",
              value: "emailing",
              count: prospects.filter((p) => p.status === "emailing").length,
            },
            {
              label: "Converted",
              value: "converted",
              count: prospects.filter((p) => p.status === "converted").length,
            },
          ] as const
        ).map((stat) => (
          <button
            key={stat.value}
            onClick={() => setPipelineFilter(stat.value)}
            className={`p-4 rounded-2xl border text-left transition-all ${
              pipelineFilter === stat.value
                ? "border-purple-500/40 bg-purple-500/5"
                : "border-[#27273A] bg-[#12121A] hover:border-purple-500/20"
            }`}
          >
            <p className="text-xs text-zinc-500 mb-1">{stat.label}</p>
            <p className="text-xl font-semibold text-white">{stat.count}</p>
          </button>
        ))}
      </div>

      {/* Pipeline Table */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-[#27273A]">
          <h3 className="text-lg font-medium text-white">Prospect Pipeline</h3>
        </div>

        {prospectsLoading ? (
          <div className="p-12 text-center text-zinc-500">
            <RefreshCw size={20} className="mx-auto mb-2 animate-spin" />
            Loading prospects...
          </div>
        ) : filteredProspects.length === 0 ? (
          <div className="p-12 text-center">
            <Target size={32} className="mx-auto mb-3 text-zinc-600" />
            <p className="text-zinc-500 text-sm mb-1">No prospects yet</p>
            <p className="text-zinc-600 text-xs">
              Click "New Prospect" to start your outreach pipeline
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#27273A]">
            {filteredProspects.map((prospect) => (
              <div
                key={prospect.id}
                className="px-6 py-4 flex items-center justify-between hover:bg-[#181824] transition-colors"
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#0A0A0F] border border-[#27273A] flex items-center justify-center shrink-0">
                    <Target size={16} className="text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {prospect.businessName}
                    </p>
                    <p className="text-xs text-zinc-500 truncate">
                      {prospect.email || "No email"} &middot;{" "}
                      {prospect.serviceName}
                    </p>
                    {prospect.lastAction && prospect.lastActionAt && (
                      <p className="text-[10px] text-zinc-600 mt-0.5 flex items-center gap-1">
                        <Clock size={8} />
                        {prospect.lastAction} &middot; {timeAgo(prospect.lastActionAt)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span
                    className={`text-[10px] px-2.5 py-1 rounded-full font-medium border ${
                      statusColors[prospect.status] || statusColors.new
                    }`}
                  >
                    {prospect.status}
                  </span>
                  <button
                    onClick={() => {
                      setSelectedProspectId(prospect.id);
                      setSelectedService({
                        id: prospect.serviceId,
                        name: prospect.serviceName,
                        description: "",
                      });
                      setSelectedPlace(
                        prospect.googlePlacesData || null
                      );
                      setFacebookUrl(
                        (prospect.facebookProfile as any)?.facebookUrl || ""
                      );
                      setEnrichedData({
                        profile: prospect.facebookProfile || {},
                        posts: (prospect.facebookPosts as any[]) || [],
                      });
                      setOutreachDrafts([]);
                      setShowWizard(true);
                      setActiveStep("emails");
                    }}
                    className="text-xs text-zinc-500 hover:text-purple-400 transition-colors"
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    onClick={() => deleteProspect(prospect.id)}
                    className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
