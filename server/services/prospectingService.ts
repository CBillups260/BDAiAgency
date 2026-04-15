import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ─── SerpAPI / Google Places Business Search ─────────────

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
  phone: string;
  website: string;
  rating: number | null;
  reviewCount: number | null;
  category: string;
  thumbnail: string;
  mapsUrl: string;
  lat: number | null;
  lng: number | null;
}

export async function searchBusiness(
  businessName: string,
  location?: string
): Promise<PlaceResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("No Google API key configured (GOOGLE_PLACES_API_KEY).");

  const query = location ? `${businessName} ${location}` : businessName;

  // Text Search to find places
  const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();

  if (searchData.status !== "OK" && searchData.status !== "ZERO_RESULTS") {
    throw new Error(searchData.error_message || `Places API error: ${searchData.status}`);
  }

  const places = (searchData.results || []).slice(0, 10);

  // Fetch details for each place to get phone, website, etc.
  const detailed = await Promise.all(
    places.map(async (p: any) => {
      let phone = "";
      let website = "";
      let detailCategory = "";

      try {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(p.place_id)}&fields=formatted_phone_number,website,types,editorial_summary&key=${apiKey}`;
        const detailRes = await fetch(detailUrl);
        const detailData = await detailRes.json();
        if (detailData.status === "OK" && detailData.result) {
          phone = detailData.result.formatted_phone_number || "";
          website = detailData.result.website || "";
          detailCategory = (detailData.result.types || [])
            .slice(0, 2)
            .map((t: string) => t.replace(/_/g, " "))
            .join(", ");
        }
      } catch {
        // If detail fetch fails, continue with basic data
      }

      let thumbnail = "";
      if (p.photos?.[0]?.photo_reference) {
        thumbnail = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${p.photos[0].photo_reference}&key=${apiKey}`;
      }

      return {
        placeId: p.place_id || "",
        name: p.name || "",
        address: p.formatted_address || "",
        phone,
        website,
        rating: p.rating ?? null,
        reviewCount: p.user_ratings_total ?? null,
        category: detailCategory || p.types?.[0]?.replace(/_/g, " ") || "",
        thumbnail,
        mapsUrl: p.place_id
          ? `https://www.google.com/maps/place/?q=place_id:${p.place_id}`
          : "",
        lat: p.geometry?.location?.lat ?? null,
        lng: p.geometry?.location?.lng ?? null,
      };
    })
  );

  return detailed;
}

// ─── Google Places Nearby Search ─────────────────────────

const NON_BUSINESS_TYPES = new Set([
  "political", "locality", "sublocality", "neighborhood", "route",
  "street_address", "bus_station", "train_station", "transit_station",
  "subway_station", "light_rail_station", "airport", "parking",
  "natural_feature", "park", "point_of_interest",
]);

function isLikelyBusiness(place: any): boolean {
  const types: string[] = place.types || [];
  if (types.length === 0) return true;
  const meaningful = types.filter((t: string) => !NON_BUSINESS_TYPES.has(t));
  return meaningful.length > 0;
}

async function fetchNearbyPage(
  url: string
): Promise<{ results: any[]; nextPageToken?: string }> {
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(data.error_message || `Places API error: ${data.status}`);
  }
  return { results: data.results || [], nextPageToken: data.next_page_token };
}

// Broad type buckets used when searching "All Businesses"
const ALL_BUSINESS_TYPES = [
  "restaurant", "cafe", "bar", "bakery",
  "store", "clothing_store", "home_goods_store", "pet_store",
  "beauty_salon", "hair_care", "spa",
  "gym",
  "dentist", "doctor", "pharmacy", "veterinary_care",
  "lawyer", "accounting", "insurance_agency", "real_estate_agency",
  "car_dealer", "car_repair", "car_wash",
  "lodging",
  "general_contractor", "plumber", "electrician", "roofing_contractor",
  "florist", "laundry", "moving_company",
  "church", "school",
];

async function fetchFirstPage(url: string): Promise<any[]> {
  const { results } = await fetchNearbyPage(url);
  return results;
}

async function fetchAllPages(url: string): Promise<any[]> {
  const allResults: any[] = [];
  let { results, nextPageToken } = await fetchNearbyPage(url);
  allResults.push(...results);

  let pages = 1;
  while (nextPageToken && pages < 3) {
    await new Promise((r) => setTimeout(r, 2000));
    const nextUrl = url.split("?")[0] + `?pagetoken=${nextPageToken}&key=${url.match(/key=([^&]+)/)?.[1]}`;
    const page = await fetchNearbyPage(nextUrl);
    allResults.push(...page.results);
    nextPageToken = page.nextPageToken;
    pages++;
  }
  return allResults;
}

async function fetchWebsites(placeIds: string[], apiKey: string): Promise<Map<string, string>> {
  const websites = new Map<string, string>();
  const BATCH_SIZE = 10;
  for (let i = 0; i < placeIds.length; i += BATCH_SIZE) {
    const batch = placeIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (pid) => {
        try {
          const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(pid)}&fields=website&key=${apiKey}`;
          const res = await fetch(url);
          const data = await res.json();
          return { pid, website: data?.result?.website || "" };
        } catch {
          return { pid, website: "" };
        }
      })
    );
    for (const r of results) {
      if (r.website) websites.set(r.pid, r.website);
    }
  }
  return websites;
}

async function dedupeAndMap(allResults: any[], apiKey: string, filterNonBusiness: boolean): Promise<PlaceResult[]> {
  const seen = new Set<string>();
  const filtered = allResults.filter((p: any) => {
    if (!p.place_id || seen.has(p.place_id)) return false;
    seen.add(p.place_id);
    return filterNonBusiness ? isLikelyBusiness(p) : true;
  });

  const placeIds = filtered.map((p: any) => p.place_id).filter(Boolean);
  const websites = await fetchWebsites(placeIds, apiKey);

  return filtered.map((p: any) => {
    let thumbnail = "";
    if (p.photos?.[0]?.photo_reference) {
      thumbnail = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=100&photo_reference=${p.photos[0].photo_reference}&key=${apiKey}`;
    }
    return {
      placeId: p.place_id || "",
      name: p.name || "",
      address: p.vicinity || p.formatted_address || "",
      phone: "",
      website: websites.get(p.place_id) || "",
      rating: p.rating ?? null,
      reviewCount: p.user_ratings_total ?? null,
      category: (p.types || []).slice(0, 2).map((t: string) => t.replace(/_/g, " ")).join(", "),
      thumbnail,
      mapsUrl: p.place_id ? `https://www.google.com/maps/place/?q=place_id:${p.place_id}` : "",
      lat: p.geometry?.location?.lat ?? null,
      lng: p.geometry?.location?.lng ?? null,
    };
  });
}

export async function searchNearby(
  lat: number,
  lng: number,
  radius = 5000,
  type?: string,
  keyword?: string
): Promise<PlaceResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("No Google API key configured.");

  const base = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&key=${apiKey}`;

  if (!type && !keyword) {
    // "All Businesses" — fan out across many business types in parallel
    const batches: Promise<any[]>[] = [];

    // One unfiltered search with full pagination for general coverage
    batches.push(fetchAllPages(base));

    // Parallel first-page searches across common business types
    for (const t of ALL_BUSINESS_TYPES) {
      batches.push(fetchFirstPage(`${base}&type=${encodeURIComponent(t)}`));
    }

    const batchResults = await Promise.all(batches);
    const merged = batchResults.flat();
    return await dedupeAndMap(merged, apiKey, true);
  }

  // Specific type or keyword — paginate normally
  let url = base;
  if (type) url += `&type=${encodeURIComponent(type)}`;
  if (keyword) url += `&keyword=${encodeURIComponent(keyword)}`;

  const allResults = await fetchAllPages(url);
  return await dedupeAndMap(allResults, apiKey, false);
}

// ─── Auto-find Facebook URL via ScrapeCreator Google Search ─

export async function findFacebookUrl(businessName: string, location?: string): Promise<string | null> {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) return null;

  const query = location
    ? `${businessName} ${location} site:facebook.com`
    : `${businessName} site:facebook.com`;

  try {
    const res = await fetch(
      `https://api.scrapecreators.com/v1/google/search?query=${encodeURIComponent(query)}&region=US`,
      { headers: { "x-api-key": apiKey } }
    );
    const data = await res.json();

    if (!data.success || !Array.isArray(data.results)) return null;

    const fbResult = data.results.find((r: any) => {
      const url = (r.url || "").toLowerCase();
      return (
        url.includes("facebook.com/") &&
        !url.includes("/posts/") &&
        !url.includes("/photos/") &&
        !url.includes("/videos/") &&
        !url.includes("/events/") &&
        !url.includes("/groups/") &&
        !url.includes("facebook.com/login") &&
        !url.includes("facebook.com/help")
      );
    });

    return fbResult?.url || null;
  } catch (err) {
    console.warn("Facebook URL auto-detection failed:", err);
    return null;
  }
}

// ─── ScrapeCreator Facebook Enrichment ───────────────────

export interface FacebookProfile {
  name: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  category: string;
  pageIntro: string;
  rating: string;
  likeCount: number;
  followerCount: number;
  profilePic: string;
  coverPhoto: string;
  businessHours: any[];
  facebookUrl: string;
}

export interface FacebookPost {
  text: string;
  date: string;
  likes: number;
  comments: number;
  shares: number;
  imageUrl: string;
  postUrl: string;
}

export interface EnrichmentResult {
  profile: FacebookProfile;
  posts: FacebookPost[];
}

export async function enrichFromFacebook(facebookUrl: string): Promise<EnrichmentResult> {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) throw new Error("SCRAPECREATORS_API_KEY is not configured.");

  // Fetch profile
  const profileRes = await fetch(
    `https://api.scrapecreators.com/v1/facebook/profile?url=${encodeURIComponent(facebookUrl)}&get_business_hours=true`,
    { headers: { "x-api-key": apiKey } }
  );
  const profileData = await profileRes.json();

  if (!profileData.success && profileData.error) {
    throw new Error(profileData.error);
  }

  const profile: FacebookProfile = {
    name: profileData.name || "",
    email: profileData.email || "",
    phone: profileData.phone || "",
    website: profileData.website || "",
    address: profileData.address || "",
    category: profileData.category || "",
    pageIntro: profileData.pageIntro || "",
    rating: profileData.rating || "",
    likeCount: profileData.likeCount || 0,
    followerCount: profileData.followerCount || 0,
    profilePic: profileData.profilePicLarge || profileData.profilePicMedium || "",
    coverPhoto: profileData.coverPhoto?.photo?.image?.uri || "",
    businessHours: profileData.businessHours || [],
    facebookUrl: profileData.url || facebookUrl,
  };

  // Fetch recent posts
  let posts: FacebookPost[] = [];
  try {
    const postsRes = await fetch(
      `https://api.scrapecreators.com/v1/facebook/profile/posts?url=${encodeURIComponent(facebookUrl)}`,
      { headers: { "x-api-key": apiKey } }
    );
    const postsData = await postsRes.json();

    if (postsData.success && Array.isArray(postsData.posts)) {
      posts = postsData.posts.slice(0, 5).map((p: any) => ({
        text: p.text || p.message || "",
        date: p.date || p.created_time || "",
        likes: p.likes_count || p.reactions?.total || 0,
        comments: p.comments_count || 0,
        shares: p.shares_count || 0,
        imageUrl: p.image || p.full_picture || "",
        postUrl: p.post_url || p.url || "",
      }));
    }
  } catch (err) {
    console.warn("Could not fetch Facebook posts:", err);
  }

  return { profile, posts };
}

// ─── Prospect Analysis ──────────────────────────────────

export interface ProspectAnalysis {
  hasWebsite: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  googleRating: number | null;
  googleReviewCount: number | null;
  facebookActive: boolean;
  lastPostAge: string;
  followerCount: number;
  isLocal: boolean;
  distanceMiles: number | null;
  conversationAngles: string[];
}

function haversineMiles(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function describePostAge(dateStr: string): { description: string; daysAgo: number } {
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return { description: "unknown date", daysAgo: 9999 };
  const daysAgo = Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
  if (daysAgo < 7) return { description: `${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`, daysAgo };
  if (daysAgo < 30) return { description: `${Math.floor(daysAgo / 7)} week${Math.floor(daysAgo / 7) === 1 ? "" : "s"} ago`, daysAgo };
  const months = Math.floor(daysAgo / 30);
  return { description: `${months} month${months === 1 ? "" : "s"} ago`, daysAgo };
}

export function analyzeProspect(data: {
  website: string;
  email: string;
  phone: string;
  googleRating: number | null;
  googleReviewCount: number | null;
  followerCount: number;
  recentPosts: { text: string; date: string }[];
  prospectLat: number | null;
  prospectLng: number | null;
  agencyLat: number;
  agencyLng: number;
  localRadiusMiles: number;
}): ProspectAnalysis {
  const angles: string[] = [];

  const hasWebsite = !!data.website?.trim();
  const hasEmail = !!data.email?.trim();
  const hasPhone = !!data.phone?.trim();

  if (!hasWebsite) angles.push("No website listed on Google — opportunity to discuss web presence");
  if (!hasEmail && !hasPhone) angles.push("No contact info publicly listed — limited discoverability");

  let facebookActive = false;
  let lastPostAge = "no posts found";
  if (data.recentPosts.length > 0) {
    const newest = data.recentPosts[0];
    const { description, daysAgo } = describePostAge(newest.date);
    lastPostAge = description;
    facebookActive = daysAgo <= 60;
    if (!facebookActive) {
      angles.push(`Facebook page hasn't been updated in ${description} — social media management opportunity`);
    }
  } else {
    angles.push("No Facebook posts found — social media presence is minimal");
  }

  const rating = data.googleRating;
  const reviews = data.googleReviewCount;
  if (rating != null && reviews != null) {
    if (rating < 4.0) angles.push(`Google rating is ${rating} stars (${reviews} reviews) — room to improve online reputation`);
    else if (reviews < 20) angles.push(`Only ${reviews} Google reviews — could benefit from more social proof`);
  }

  let isLocal = false;
  let distanceMiles: number | null = null;
  if (
    data.agencyLat && data.agencyLng &&
    data.prospectLat != null && data.prospectLng != null
  ) {
    distanceMiles = Math.round(haversineMiles(
      data.agencyLat, data.agencyLng,
      data.prospectLat, data.prospectLng
    ));
    isLocal = distanceMiles <= data.localRadiusMiles;
    if (isLocal) angles.push(`You are ${distanceMiles} miles away — mention being local`);
  }

  return {
    hasWebsite, hasEmail, hasPhone,
    googleRating: rating, googleReviewCount: reviews,
    facebookActive, lastPostAge,
    followerCount: data.followerCount || 0,
    isLocal, distanceMiles,
    conversationAngles: angles,
  };
}

// ─── Owner Name Lookup ──────────────────────────────────

const COMMON_NICKNAMES: Record<string, string> = {
  christopher: "Chris", christine: "Chris", christina: "Chris",
  william: "Will", elizabeth: "Liz", nicholas: "Nick",
  michael: "Mike", robert: "Rob", richard: "Rich",
  jennifer: "Jen", jessica: "Jess", katherine: "Kate",
  catherine: "Kate", stephanie: "Steph", alexander: "Alex",
  alexandra: "Alex", benjamin: "Ben", nathaniel: "Nate",
  jonathan: "Jon", daniel: "Dan", matthew: "Matt",
  timothy: "Tim", thomas: "Tom", patricia: "Pat",
  anthony: "Tony", gregory: "Greg", deborah: "Deb",
  frederick: "Fred", lawrence: "Larry", theodore: "Ted",
  samuel: "Sam", zachary: "Zach", joshua: "Josh",
  andrew: "Andy", joseph: "Joe", patrick: "Pat",
  raymond: "Ray", phillip: "Phil",
  douglas: "Doug", randolph: "Randy", dominic: "Dom",
  gabrielle: "Gabby", madeleine: "Maddie", victoria: "Vicky",
  abigail: "Abby", margaret: "Maggie", jacqueline: "Jackie",
};

export function shortenFirstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return COMMON_NICKNAMES[first.toLowerCase()] || first;
}

export async function findOwnerName(
  businessName: string,
  address: string,
  facebookPageIntro: string,
  website: string
): Promise<string | null> {
  try {
    const prompt = `You are helping find the owner or manager's first name of a local business.

Business: ${businessName}
Location: ${address}
${facebookPageIntro ? `Facebook About: ${facebookPageIntro}` : ""}
${website ? `Website: ${website}` : ""}

Based on this information, can you determine the owner's or primary contact's first name?
- Look for names mentioned in the "About" section that sound like they own or run the business.
- If the about section says something like "Taylor started..." or "owned by Sarah" — extract that name.
- If you cannot confidently determine a name, respond with just: UNKNOWN
- If you can determine a name, respond with ONLY the first name (e.g., "Taylor"). Nothing else.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: { temperature: 0.1 },
    });
    const result = response.text?.trim() || "";
    if (!result || result.toUpperCase() === "UNKNOWN" || result.length > 20 || result.includes(" ")) {
      return null;
    }
    return result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
  } catch {
    return null;
  }
}

// ─── AI Email & DM Sequence Generation ──────────────────

export interface OutreachDraft {
  dayNumber: number;
  emailSubject: string;
  emailBody: string;
  dmBody: string;
}

export interface SenderContext {
  userName: string;
  userEmail: string;
  agencyName: string;
  agencyDescription: string;
  agencyWebsite: string;
  agencyEmail: string;
  agencyPhone: string;
  ownerName: string;
  ownerTitle: string;
  brandVoice: string;
  valuePropositions: string[];
  caseStudies: string;
  signOffName: string;
  agencyLat: number;
  agencyLng: number;
  localRadiusMiles: number;
}

export async function generateOutreachSequence(
  prospect: {
    businessName: string;
    email: string;
    category: string;
    address: string;
    website: string;
    pageIntro: string;
    recentPosts: { text: string; date: string }[];
    googleRating: number | null;
    googleReviewCount: number | null;
    followerCount: number;
    prospectLat: number | null;
    prospectLng: number | null;
  },
  service: { name: string; description: string },
  analysis: ProspectAnalysis,
  sender?: Partial<SenderContext>,
  ownerName?: string | null
): Promise<OutreachDraft[]> {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // Only include posts from the last 30 days
  const freshPosts = prospect.recentPosts.filter((p) => {
    const { daysAgo } = describePostAge(p.date);
    return daysAgo <= 30;
  });
  const postsContext = freshPosts.length > 0
    ? `\nRECENT Facebook activity (last 30 days):\n${freshPosts.map((p, i) => `${i + 1}. "${p.text}" (${p.date})`).join("\n")}`
    : "";

  const senderFullName = sender?.ownerName || sender?.userName || "the team";
  const senderShortName = shortenFirstName(senderFullName);
  const agencyName = sender?.agencyName || "BrandD AI Agency";
  const signOff = sender?.signOffName || senderFullName;

  const cityMatch = prospect.address.match(/,\s*([^,]+),\s*[A-Z]{2}/);
  const cityName = cityMatch ? cityMatch[1].trim() : "";

  let senderBlock = `\nYOU (THE SENDER):
- Your name: ${senderFullName} (use "${senderShortName}" in DMs — keep it casual)
- Company: ${agencyName}`;
  if (sender?.ownerTitle) senderBlock += `\n- Your role: ${sender.ownerTitle}`;
  if (analysis.isLocal && cityName) senderBlock += `\n- You are LOCAL — you work in/around ${cityName}`;
  else if (analysis.isLocal) senderBlock += `\n- You are LOCAL to this business's area`;
  if (sender?.agencyPhone) senderBlock += `\n- Phone: ${sender.agencyPhone}`;
  if (sender?.agencyWebsite) senderBlock += `\n- Website: ${sender.agencyWebsite}`;
  if (sender?.caseStudies) senderBlock += `\n- Past work / results: ${sender.caseStudies}`;

  const ownerBlock = ownerName
    ? `\nBUSINESS OWNER/CONTACT: ${ownerName} — address them by first name in the greeting (e.g., "Hey ${ownerName},")`
    : `\nBUSINESS OWNER/CONTACT: Unknown — use a friendly generic greeting like "Hey there," or "Hi ${prospect.businessName} team,"`;

  const anglesBlock = analysis.conversationAngles.length > 0
    ? `\nCONVERSATION ANGLES (observations about their business — weave the strongest one into message 1):\n${analysis.conversationAngles.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
    : "";

  const localNote = analysis.isLocal
    ? `\nLOCALITY: You are local (${analysis.distanceMiles} miles away). Always mention being local/in the area naturally. Example: "I work as a local [role] here in ${cityName || "the area"}." Do NOT say exact miles.`
    : "";

  const prompt = `TODAY'S DATE: ${today}

You are writing outreach messages on behalf of a real person to a local business owner. The goal is to start a conversation and get a 15-minute meeting. Write like a human — casual, direct, specific.
${senderBlock}
${ownerBlock}

TARGET BUSINESS:
- Business name: ${prospect.businessName}
- Type of business: ${prospect.category}
- Location: ${prospect.address}
- Their website: ${prospect.website || "(none listed on Google)"}
- About them: ${prospect.pageIntro || "(no description available)"}
- Google Rating: ${prospect.googleRating != null ? `${prospect.googleRating} stars (${prospect.googleReviewCount} reviews)` : "not available"}
- Facebook Followers: ${prospect.followerCount || "unknown"}${postsContext}

THE SERVICE YOU'RE OFFERING:
- Service name: ${service.name}
- What it does: ${service.description}

YOUR JOB — SUGGEST SPECIFIC FEATURES FOR THEIR BUSINESS:
Based on what you know about "${prospect.businessName}" (a "${prospect.category}"), think about what specific features or improvements from "${service.name}" would actually help THIS business. Don't be generic.

Examples of being specific:
- For a movie theater + web development: "manage movies, events, use AI to craft descriptions and titles, and easily manage everything"
- For a salon + web development: "let customers book appointments online, see your services and pricing, and even chat with an AI assistant for questions"
- For a restaurant + social media: "post daily specials automatically, respond to reviews, and keep your Instagram looking fresh"
- For a gym + web development: "let members sign up for classes online, track their memberships, and get automated reminders"

Think about what "${prospect.category}" businesses actually NEED and list 2-3 specific features in your message. Not generic marketing speak — real, useful things.
${anglesBlock}${localNote}

GENERATE A 3-MESSAGE SEQUENCE (email AND DM versions for each):

--- MESSAGE 1 — INTRODUCTION ---
The DM should follow this EXACT structure (this is a real example that worked):
"Hey Taylor, My name is Chris and I work as a local marketer and web developer here in Angola. I'm not sure you'll be interested but I figured I'd reach out. I can completely revamp your website and add helpful features that will allow you to easily manage movies, events, use AI to craft descriptions and titles, and easily manage everything. I build out fully custom websites. Got 15 mins for a quick chat next week?"

Notice the structure:
1. Greeting with their name
2. "My name is [short name] and I [what you do — state your core service clearly: web developer, marketer, etc.]"
3. ${analysis.isLocal ? `"here in ${cityName || "the area"}" — mention being local` : ""}
4. "I'm not sure you'll be interested but figured I'd reach out"
5. "I can [core action tied to service — e.g., 'completely revamp your website', 'handle your social media', 'build you a custom site'] and add helpful features that will allow you to [2-3 SPECIFIC features for their business type]"
6. A reinforcing statement about your service: "I build out fully custom websites" or "We do full-service social media management" — so they clearly know what you do
7. End with the ask — "Got 15 mins for a quick chat next week?"

CRITICAL for DMs: Do NOT sign off with your name at the end. You already said your name in the intro. Ending with your name again looks robotic. Just end with the meeting ask.

The EMAIL version should cover the same points but can be slightly more detailed. Emails DO get a sign-off.

--- MESSAGE 2 — FOLLOW-UP ---
- Quick, friendly nudge
- Mention a specific result you've achieved for a similar business type (make it sound realistic)
- Keep it short: "Would love to show you — got 15 minutes?"

--- MESSAGE 3 — FINAL TOUCH ---
- Ultra short, no pressure
- "Totally understand if the timing isn't right, just wanted to leave the door open."
- Include contact info for emails

CRITICAL RULES:
- Write like a REAL PERSON texting someone they'd like to do business with. Not a marketer.
- ALWAYS clearly state what your core service is (e.g., "web developer", "marketer", "social media manager"). The recipient must understand what you DO. Features alone without context are confusing.
- Be SPECIFIC about features and benefits for their type of business. "Help your business grow" is BANNED. Instead say exactly what you'd build/do for them.
- NEVER use: AI-powered, cutting-edge, leverage, optimize, revolutionize, transform, innovative, solutions, synergy, scalable, game-changer, next-level
- You CAN mention AI naturally — "use AI to craft descriptions" or "add an AI assistant" is fine.
- NEVER reference Facebook posts older than 30 days from today (${today}). If no recent posts exist, do NOT mention their social media content.
- DMs: MAX 70 words. Do NOT sign off with your name at the end — you already introduced yourself at the start. Just end with the meeting ask.
- Emails: MAX 120 words. Subject lines: casual, under 50 chars. Sign off as "${signOff}".
- ALWAYS end with a meeting request. The ask should feel low-pressure: "Got 15 mins?" or "Free for a quick chat next week?"

Return ONLY valid JSON — an array of 3 objects with keys: dayNumber (1-3), emailSubject, emailBody, dmBody. No markdown fences.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: prompt,
    config: {
      temperature: 0.7,
      responseMimeType: "application/json",
    },
  });

  const text = response.text?.trim() || "[]";
  try {
    const drafts: OutreachDraft[] = JSON.parse(text);
    return drafts.sort((a, b) => a.dayNumber - b.dayNumber);
  } catch {
    console.error("Failed to parse Gemini outreach response:", text);
    throw new Error("AI failed to generate the outreach sequence. Please try again.");
  }
}
