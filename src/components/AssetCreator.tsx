import { authedFetch } from '../lib/api';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Loader,
  Download,
  RefreshCw,
  Trash2,
  Check,
  Plus,
  Upload,
  X,
  Image,
  Save,
  Bookmark,
  Package,
} from '@geist-ui/icons';
import { addToFlowBucket, useFlowBucketDrop, flowItemToBase64, type FlowBucketItem } from './FlowBucket';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';
import { useFirestoreAccounts, useFirestoreMediaAssets, useFirestoreAccount, type FirestoreMenuItem } from '../hooks/useFirestore';
import TitleGenerator from './TitleGenerator';

type AssetSubTab = 'product' | 'title';
type AssetCategory = 'food' | 'product';

// ─── Config ──────────────────────────────────────────────

const FOOD_MODES = [
  { id: 'isolate', label: 'Isolate', sub: 'Extract & render on solid bg', requiresRef: true },
  { id: 'variation', label: 'Variation', sub: 'Inspired by reference, with changes', requiresRef: true },
  { id: 'subtle-variations', label: 'Subtle Variations', sub: 'Tiny camera nudges, same core shot', requiresRef: true },
  { id: 'full', label: 'Full Asset', sub: 'Solid background, clean edges' },
  { id: 'macro', label: 'Macro Shot', sub: 'Extreme close-up, fills the frame' },
  { id: 'detail', label: 'Detail Crop', sub: 'Tight crop on a feature, less than macro' },
  { id: 'closeup', label: 'Close-Up', sub: 'Subject fills frame, no surroundings' },
  { id: 'mcu', label: 'Medium Close-Up', sub: 'Subject + small ring of context' },
  { id: 'medium', label: 'Medium Shot', sub: 'Subject with plate & immediate context' },
  { id: 'wide', label: 'Wide / Pulled-Back', sub: 'Full scene, subject in environment' },
  { id: 'overhead', label: 'Overhead', sub: 'Top-down framing, no restyling' },
  { id: 'high45', label: 'High Angle (45°)', sub: 'Classic 3/4-down food angle' },
  { id: 'threequarter', label: '3/4 View', sub: 'Front + side, adds depth & dimension' },
  { id: 'eye', label: 'Eye Level', sub: 'Straight-on, directly facing subject' },
  { id: 'side', label: 'Side Profile', sub: 'Straight side, shows layers & height' },
  { id: 'low-angle', label: 'Hero / Low Angle', sub: 'Looking up, makes subject feel grand' },
];

const PRODUCT_MODES = [
  { id: 'isolate', label: 'Isolate', sub: 'Extract & render on solid bg', requiresRef: true },
  { id: 'variation', label: 'Variation', sub: 'Inspired by reference, with changes', requiresRef: true },
  { id: 'subtle-variations', label: 'Subtle Variations', sub: 'Tiny camera nudges, same core shot', requiresRef: true },
  { id: 'full', label: 'Full Asset', sub: 'Solid background, clean edges' },
  { id: 'macro', label: 'Macro Shot', sub: 'Extreme close-up on material & detail' },
  { id: 'hero', label: 'Hero Shot', sub: 'Single product, dramatic staging' },
  { id: 'lifestyle', label: 'Lifestyle', sub: 'Product in real-world context' },
  { id: 'flat-lay', label: 'Flat Lay', sub: 'Overhead styled arrangement' },
  { id: 'group', label: 'Group Shot', sub: 'Multiple products together' },
  { id: 'scale', label: 'Scale Shot', sub: 'Show size & proportion with context' },
  { id: 'detail-texture', label: 'Detail / Texture', sub: 'Close-up of material & finish' },
  { id: 'packaging', label: 'Packaging', sub: 'Box, label, unboxing angle' },
  { id: 'in-use', label: 'In Use', sub: 'Product being used by a person' },
  { id: 'minimalist', label: 'Minimalist', sub: 'Clean, simple, negative space' },
  { id: 'editorial', label: 'Editorial', sub: 'Magazine-quality, polished' },
  { id: 'dark-moody', label: 'Dark & Moody', sub: 'Deep shadows, premium feel' },
  { id: 'bright-airy', label: 'Bright & Airy', sub: 'High-key, soft, luminous' },
  { id: 'studio', label: 'Studio Catalog', sub: 'Clean, e-commerce white-bg style' },
  { id: 'exploded', label: 'Exploded View', sub: 'Components separated, layered' },
  { id: 'floating', label: 'Floating', sub: 'Levitating, zero gravity, dynamic' },
  { id: 'splash-action', label: 'Splash / Action', sub: 'Dynamic liquid, motion, energy' },
  { id: 'neon-glow', label: 'Neon Glow', sub: 'Cyberpunk, neon-lit, futuristic' },
  { id: 'luxury', label: 'Luxury / Premium', sub: 'Velvet, marble, gold accents' },
  { id: 'reflection', label: 'Reflection', sub: 'Mirror surface, polished table' },
  { id: 'silhouette', label: 'Silhouette', sub: 'Backlit outline, mysterious' },
  { id: 'color-pop', label: 'Color Pop', sub: 'Product color vs contrasting bg' },
  { id: 'shadow-play', label: 'Shadow Play', sub: 'Creative shadow compositions' },
  { id: 'outdoor-nature', label: 'Outdoor / Nature', sub: 'Product in natural setting' },
];

// Shot-type modes own the camera framing/distance/angle. When one of these is selected,
// the Angle selector hides any options that would conflict (e.g. picking "Overhead" mode
// + "Side Profile" angle is contradictory) and only shows pure compositional/POV modifiers.
const SHOT_TYPE_MODES = new Set([
  'macro', 'detail', 'closeup', 'mcu', 'medium', 'wide',
  'overhead', 'high45', 'threequarter', 'eye', 'side', 'low-angle',
]);

const FOOD_ANGLES = [
  { id: '', label: 'Default', compatibleWithShotType: true },
  { id: 'Straight-on front view, eye level', label: 'Eye Level', compatibleWithShotType: false },
  { id: '45-degree angle, slightly above, classic food photography', label: '45° Classic', compatibleWithShotType: false },
  { id: 'Three-quarter angle showing depth and dimension', label: '3/4 View', compatibleWithShotType: false },
  { id: 'Top-down overhead flat lay view, directly above', label: 'Top Down', compatibleWithShotType: false },
  { id: 'Side profile view, straight on, showing layers and height', label: 'Side Profile', compatibleWithShotType: false },
  { id: 'Low angle, looking up at the dish, hero shot', label: 'Low Angle', compatibleWithShotType: false },
  { id: 'High angle, looking down at roughly 60 degrees', label: 'High Angle', compatibleWithShotType: false },
  { id: 'Dutch angle, slightly tilted camera for dynamic tension', label: 'Dutch Tilt', compatibleWithShotType: true },
  { id: 'Extreme low angle from table level, worms eye view', label: "Worm's Eye", compatibleWithShotType: false },
  { id: 'Over the shoulder perspective, diner POV', label: 'Over Shoulder', compatibleWithShotType: true },
  { id: 'Slight birds eye view, 75-degree downward angle', label: "Bird's Eye", compatibleWithShotType: false },
  { id: 'Diagonal composition, dynamic angled perspective', label: 'Diagonal', compatibleWithShotType: true },
  { id: 'Close-up detail shot, shallow depth of field, tight framing', label: 'Close-Up', compatibleWithShotType: false },
  { id: 'Straight-on front view, slightly below eye level', label: 'Below Eye', compatibleWithShotType: false },
  { id: 'Dramatic upward angle, making dish look grand and imposing', label: 'Hero Shot', compatibleWithShotType: false },
  { id: 'Pulled back wide angle showing full table and surroundings', label: 'Wide Establishing', compatibleWithShotType: false },
  { id: 'Tilt-shift perspective, miniature effect, selective focus', label: 'Tilt Shift', compatibleWithShotType: true },
  { id: 'Directly from behind the dish, showing depth toward camera', label: 'Rear View', compatibleWithShotType: true },
  { id: 'Fork or spoon lifting a bite, mid-action angle', label: 'Bite Lift', compatibleWithShotType: true },
  { id: 'Looking down the length of a long table, vanishing point', label: 'Table Length', compatibleWithShotType: true },
  { id: 'Shooting through foreground elements like glasses or candles', label: 'Shoot-Through', compatibleWithShotType: true },
  { id: 'Cross-section, sliced in half revealing internal layers', label: 'Cross Section', compatibleWithShotType: true },
  { id: 'Handheld casual angle, slightly off-axis, candid feeling', label: 'Handheld Casual', compatibleWithShotType: true },
];

const PRODUCT_ANGLES = [
  { id: '', label: 'Default' },
  { id: 'Straight-on front view, eye level, product centered', label: 'Front View' },
  { id: '45-degree angle, slightly above, revealing top and side', label: '45° Angle' },
  { id: 'Three-quarter angle showing depth and dimension of product', label: '3/4 View' },
  { id: 'Top-down overhead view, directly above product', label: 'Top Down' },
  { id: 'Side profile view, straight on', label: 'Side Profile' },
  { id: 'Low angle, looking up at product, making it look powerful', label: 'Low Angle' },
  { id: 'High angle, looking down at roughly 60 degrees', label: 'High Angle' },
  { id: 'Extreme low angle from surface level, dramatic hero perspective', label: "Worm's Eye" },
  { id: 'Back view showing reverse side or label', label: 'Back View' },
  { id: 'Detail close-up on logo, texture, or key feature', label: 'Detail Close-Up' },
  { id: 'Slight birds eye view at 75-degrees, showcase top features', label: "Bird's Eye" },
  { id: 'Product tilted at an angle, dynamic and energetic', label: 'Dynamic Tilt' },
  { id: 'Straight above, slightly rotated showing multiple faces', label: 'Rotated Flat' },
  { id: 'Product in hand, scale reference, human interaction', label: 'In-Hand' },
  { id: 'Dramatic upward angle, making product look grand and premium', label: 'Hero Shot' },
];

const CAMERA_BODIES = [
  { id: '', label: 'Default' },
  // ── Smartphones ──
  { id: 'Shot on iPhone 16 Pro Max with 48MP main sensor and ProRAW processing', label: 'iPhone 16 Pro' },
  { id: 'Shot on iPhone 15 Pro Max', label: 'iPhone 15 Pro' },
  { id: 'Shot on Samsung Galaxy S24 Ultra with 200MP sensor, crisp detail', label: 'Galaxy S24 Ultra' },
  { id: 'Shot on Google Pixel 9 Pro with computational photography, natural colors', label: 'Pixel 9 Pro' },
  // ── Canon ──
  { id: 'Shot on Canon EOS R5 Mark II mirrorless, 45MP full-frame sensor', label: 'Canon R5 Mark II' },
  { id: 'Shot on Canon EOS R5 mirrorless, full-frame sensor', label: 'Canon R5' },
  { id: 'Shot on Canon EOS R6 Mark II mirrorless, 24MP full-frame sensor', label: 'Canon R6 Mark II' },
  { id: 'Shot on Canon EOS R3 professional mirrorless, stacked full-frame sensor', label: 'Canon R3' },
  { id: 'Shot on Canon EOS 5D Mark IV DSLR, full-frame sensor', label: 'Canon 5D Mark IV' },
  // ── Sony ──
  { id: 'Shot on Sony A7R V mirrorless, 61MP high-resolution full-frame sensor', label: 'Sony A7R V' },
  { id: 'Shot on Sony A7 IV mirrorless, 33MP full-frame sensor', label: 'Sony A7 IV' },
  { id: 'Shot on Sony A7C II compact full-frame mirrorless', label: 'Sony A7C II' },
  { id: 'Shot on Sony A1 flagship mirrorless, 50MP stacked full-frame sensor', label: 'Sony A1' },
  { id: 'Shot on Sony A9 III global-shutter full-frame mirrorless', label: 'Sony A9 III' },
  // ── Nikon ──
  { id: 'Shot on Nikon Z8 mirrorless, 45MP stacked full-frame sensor', label: 'Nikon Z8' },
  { id: 'Shot on Nikon Z9 flagship mirrorless, stacked full-frame sensor', label: 'Nikon Z9' },
  { id: 'Shot on Nikon Z6 III full-frame mirrorless', label: 'Nikon Z6 III' },
  // ── Fujifilm ──
  { id: 'Shot on Fujifilm X-T5 APS-C mirrorless, 40MP X-Trans sensor, rich Fuji color science', label: 'Fuji X-T5' },
  { id: 'Shot on Fujifilm GFX 100S II medium-format mirrorless, 102MP sensor, incredible detail', label: 'Fuji GFX 100S II' },
  { id: 'Shot on Fujifilm X100VI compact with classic film simulation look', label: 'Fuji X100VI' },
  // ── Leica ──
  { id: 'Shot on Leica Q3 full-frame compact with signature Leica color rendering', label: 'Leica Q3' },
  { id: 'Shot on Leica SL3 full-frame mirrorless, cinematic look', label: 'Leica SL3' },
  // ── Hasselblad ──
  { id: 'Shot on Hasselblad X2D 100C medium-format mirrorless, 100MP sensor, extreme resolution', label: 'Hasselblad X2D' },
  // ── Film ──
  { id: 'Shot on Kodak Portra 400 35mm film, warm skin tones, fine grain', label: 'Kodak Portra 400' },
  { id: 'Shot on Fujifilm Pro 400H 35mm film, soft pastel tones', label: 'Fuji Pro 400H' },
  { id: 'Shot on CineStill 800T tungsten film, signature red halation around highlights', label: 'CineStill 800T' },
  { id: 'Shot on Ilford HP5 Plus 400 black-and-white film, classic grain', label: 'Ilford HP5 B&W' },
];

const LENS_TYPES = [
  { id: '', label: 'Default' },
  // ── Prime focal lengths ──
  { id: 'with a 14mm ultra-wide-angle lens, dramatic perspective distortion', label: '14mm Ultra Wide' },
  { id: 'with a 24mm wide-angle lens', label: '24mm Wide' },
  { id: 'with a 35mm lens, natural perspective, street-photography feel', label: '35mm Natural' },
  { id: 'with a 50mm lens, classic nifty-fifty perspective, true-to-life rendering', label: '50mm Classic' },
  { id: 'with an 85mm portrait lens, beautiful bokeh and compressed background', label: '85mm Portrait' },
  { id: 'with a 100mm macro lens, extreme close-up and 1:1 magnification', label: '100mm Macro' },
  { id: 'with a 105mm macro lens, razor-sharp focus on fine textures', label: '105mm Macro' },
  { id: 'with a 135mm telephoto lens, tight framing and smooth background separation', label: '135mm Telephoto' },
  { id: 'with a 200mm telephoto lens, extreme background compression and isolated subject', label: '200mm Telephoto' },
  // ── Zoom ──
  { id: 'with a 24-70mm f/2.8 standard zoom lens, versatile framing', label: '24-70mm Zoom' },
  { id: 'with a 70-200mm f/2.8 telephoto zoom lens', label: '70-200mm Zoom' },
  // ── Specialty / art ──
  { id: 'with a tilt-shift 24mm lens, selective focus plane and miniature effect', label: 'Tilt-Shift 24mm' },
  { id: 'with a fisheye 8mm lens, extreme barrel distortion and 180-degree view', label: 'Fisheye 8mm' },
  { id: 'with an anamorphic cinema lens, horizontal flares and widescreen look', label: 'Anamorphic Cine' },
  { id: 'with a Lensbaby Velvet 56mm art lens, dreamy soft glow, ethereal look', label: 'Lensbaby Velvet' },
  { id: 'with a vintage Helios 44-2 58mm lens, swirly bokeh and analog character', label: 'Helios 44-2 Vintage' },
  { id: 'with a Petzval 80.5mm art lens, swirly bokeh and brass-barrel character', label: 'Petzval Art' },
];

const F_STOPS = [
  { id: '', label: 'Default' },
  { id: 'shot wide open at f/1.2, ultra-shallow depth of field and creamy bokeh', label: 'f/1.2' },
  { id: 'shot at f/1.4, very shallow depth of field and buttery bokeh', label: 'f/1.4' },
  { id: 'shot at f/1.8, shallow depth of field with smooth background blur', label: 'f/1.8' },
  { id: 'shot at f/2.8, moderately shallow depth of field, subject isolation', label: 'f/2.8' },
  { id: 'shot at f/4, balanced depth of field', label: 'f/4' },
  { id: 'shot at f/5.6, a versatile mid-range aperture with good sharpness', label: 'f/5.6' },
  { id: 'shot at f/8, the lens sweet spot for maximum sharpness', label: 'f/8' },
  { id: 'shot at f/11, deep depth of field with most of the scene in focus', label: 'f/11' },
  { id: 'shot at f/16, maximum depth of field, everything tack sharp front to back', label: 'f/16' },
];

const SHUTTER_SPEEDS = [
  { id: '', label: 'Default' },
  { id: 'frozen with a 1/1000s shutter speed, tack-sharp action', label: '1/1000s Freeze' },
  { id: 'shot at 1/250s shutter speed, crisp handheld capture', label: '1/250s Crisp' },
  { id: 'shot at 1/60s shutter speed, natural handheld feel', label: '1/60s Handheld' },
  { id: 'shot with a slow 1/15s shutter speed, subtle motion blur', label: '1/15s Motion' },
  { id: 'long exposure at 1s shutter speed, pronounced motion trails', label: '1s Long Exposure' },
];

const ISO_SETTINGS = [
  { id: '', label: 'Default' },
  { id: 'shot at ISO 100, ultra-clean and noise-free rendering', label: 'ISO 100 Clean' },
  { id: 'shot at ISO 400, minimal noise, natural light look', label: 'ISO 400' },
  { id: 'shot at ISO 1600, slight grain for an atmospheric feel', label: 'ISO 1600 Grainy' },
  { id: 'shot at ISO 6400, visible grain, low-light documentary look', label: 'ISO 6400 Low-Light' },
];

const LIGHTING_OPTIONS = [
  { id: '', label: 'Default' },
  { id: 'Natural lighting', label: 'Natural' },
  { id: 'Golden hour warm lighting', label: 'Golden Hour' },
  { id: 'Ambient restaurant lighting', label: 'Ambient' },
  { id: 'Slightly overexposed, bright and airy', label: 'Overexposed' },
  { id: 'Dramatic side lighting, deep shadows', label: 'Dramatic' },
  { id: 'Soft diffused studio lighting', label: 'Studio Soft' },
  { id: 'Backlit with rim light', label: 'Backlit' },
];

const FOOD_DETAILS = [
  { id: 'Slight motion blur', label: 'Motion Blur' },
  { id: 'Minor JPEG compression artifacts', label: 'JPEG Artifacts' },
  { id: 'Realistic film grain', label: 'Film Grain' },
  { id: 'Unposed, candid feel', label: 'Candid' },
  { id: 'Steam and condensation visible', label: 'Steam' },
  { id: 'Glistening, fresh out of the kitchen', label: 'Glistening' },
  { id: 'Melting, dripping, oozing textures', label: 'Melting' },
  { id: 'Crumbs and imperfections visible', label: 'Imperfect' },
  { id: 'Sauce drizzle, artistic splatter', label: 'Sauce Drizzle' },
  { id: 'Condensation on glass, cold beverages', label: 'Condensation' },
  { id: 'Fresh herbs and garnish scattered', label: 'Fresh Garnish' },
  { id: 'Cheese pull, stretchy melted cheese', label: 'Cheese Pull' },
];

const PRODUCT_DETAILS = [
  { id: 'Slight motion blur', label: 'Motion Blur' },
  { id: 'Realistic film grain', label: 'Film Grain' },
  { id: 'Reflections on surface, glossy finish', label: 'Reflections' },
  { id: 'Dramatic shadows, hard light', label: 'Hard Shadows' },
  { id: 'Soft shadows, diffused light', label: 'Soft Shadows' },
  { id: 'Water droplets, splashes on product', label: 'Water Drops' },
  { id: 'Dust particles in light beam', label: 'Dust Particles' },
  { id: 'Lens flare, cinematic highlight', label: 'Lens Flare' },
  { id: 'Textured surface visible, close-up material detail', label: 'Surface Texture' },
  { id: 'Holographic, iridescent finish', label: 'Holographic' },
];

const COMPOSITION_OPTIONS = [
  { id: '', label: 'Default' },
  { id: 'Perfectly centered, symmetrical', label: 'Centered' },
  { id: 'Awkward angle, imperfect composition, unplanned', label: 'Imperfect' },
  { id: 'Rule of thirds, off-center', label: 'Rule of Thirds' },
  { id: 'Tight crop, filling the frame', label: 'Tight Crop' },
  { id: 'Negative space on one side', label: 'Negative Space' },
];

const MODELS = [
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro', sub: 'Higher quality, slower' },
  { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash', sub: 'Faster, thinking mode' },
  { id: 'gpt-image-2', label: 'OpenAI Image 2', sub: 'OpenAI, photo-realistic' },
];

const RESOLUTIONS = [
  { id: '512', label: '512px', sub: 'Fast preview' },
  { id: '1K', label: '1K', sub: 'Standard' },
  { id: '2K', label: '2K', sub: 'High res' },
  { id: '4K', label: '4K', sub: 'Ultra' },
];

const THINKING_LEVELS = [
  { id: '', label: 'Off', sub: 'No thinking' },
  { id: 'Minimal', label: 'Minimal', sub: 'Light reasoning' },
  { id: 'High', label: 'High', sub: 'Deep reasoning' },
];

const BG_COLORS = [
  { hex: '#00B140', name: 'Chroma Green' },
  { hex: '#00FF00', name: 'Green Screen' },
  { hex: '#0047FF', name: 'Chroma Blue' },
  { hex: '#0000FF', name: 'Blue Screen' },
  { hex: '#808080', name: 'Mid Gray' },
  { hex: '#A0A0A0', name: 'Light Gray' },
  { hex: '#C0C0C0', name: 'Silver' },
  { hex: '#FFFFFF', name: 'White' },
  { hex: '#E0E0E0', name: 'Soft Gray' },
  { hex: '#000000', name: 'Black' },
];

const RATIOS = [
  { id: '1:1' as const, label: '1:1', sub: 'Square' },
  { id: '4:5' as const, label: '4:5', sub: 'Portrait' },
  { id: '9:16' as const, label: '9:16', sub: 'Story' },
  { id: '16:9' as const, label: '16:9', sub: 'Wide' },
];

interface GeneratedAsset {
  base64: string;
  mimeType: string;
  prompt: string;
  timestamp: number;
}

// ─── Component ───────────────────────────────────────────

export default function AssetCreator() {
  const [assetSubTab, setAssetSubTab] = useState<AssetSubTab>('product');
  const [assetCategory, setAssetCategory] = useState<AssetCategory>('food');

  // Account
  const { accounts, loading: accountsLoading } = useFirestoreAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const { account: fullAccount } = useFirestoreAccount(selectedAccountId);
  const { assets: savedAssets, addAsset: addMediaAsset, removeAsset: removeMediaAsset } = useFirestoreMediaAssets(selectedAccountId);
  const [saving, setSaving] = useState<number | null>(null);
  const [canvaStatus, setCanvaStatus] = useState<{ connected: boolean; configured: boolean } | null>(null);
  const [sendingToCanva, setSendingToCanva] = useState<number | null>(null);

  // Core
  const [dishName, setDishName] = useState('');
  const [model, setModel] = useState('gemini-3-pro-image-preview');
  const [resolution, setResolution] = useState('1K');
  const [thinkingLevel, setThinkingLevel] = useState('');
  const [mode, setMode] = useState('full');
  const [variationNotes, setVariationNotes] = useState('');
  const [refImage, setRefImage] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);

  // Style options
  const [angle, setAngle] = useState('');

  useEffect(() => {
    if (assetCategory !== 'food') return;
    if (!SHOT_TYPE_MODES.has(mode)) return;
    if (!angle) return;
    const current = FOOD_ANGLES.find((a) => a.id === angle);
    if (!current?.compatibleWithShotType) setAngle('');
  }, [mode, assetCategory, angle]);

  const [cameraBody, setCameraBody] = useState('');
  const [lensType, setLensType] = useState('');
  const [fStop, setFStop] = useState('');
  const [shutterSpeed, setShutterSpeed] = useState('');
  const [isoSetting, setIsoSetting] = useState('');
  const camera = [cameraBody, lensType, fStop, shutterSpeed, isoSetting].filter(Boolean).join(', ');
  const [lighting, setLighting] = useState('');
  const [selectedDetails, setSelectedDetails] = useState<string[]>([]);
  const [composition, setComposition] = useState('');

  // Background
  const [bgMode, setBgMode] = useState<'natural' | 'solid'>('natural');
  const [bgColor, setBgColor] = useState('#00B140');
  const [customBg, setCustomBg] = useState('');
  const [ratio, setRatio] = useState<string>('1:1');

  // Results
  const [generating, setGenerating] = useState(false);
  const [count, setCount] = useState(1);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeBg = customBg || bgColor;

  // Flow Bucket drop support
  const flowDrop = useFlowBucketDrop(async (item: FlowBucketItem) => {
    const data = await flowItemToBase64(item);
    setRefImage({ base64: data.base64, mimeType: data.mimeType, preview: data.preview });
  });

  // Check Canva connection status on mount
  useEffect(() => {
    authedFetch('/api/canva/status').then(r => r.json()).then(setCanvaStatus).catch(() => {});
  }, []);

  const connectCanva = async () => {
    const res = await authedFetch('/api/canva/auth');
    const data = await res.json();
    if (data.url) window.open(data.url, '_blank', 'width=600,height=700');
  };

  const sendToCanva = async (idx: number) => {
    const asset = assets[idx];
    if (!asset) return;
    setSendingToCanva(idx);
    setError(null);
    try {
      const res = await authedFetch('/api/canva/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64: asset.base64,
          mimeType: asset.mimeType,
          name: asset.prompt || `Asset ${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSendingToCanva(null);
    }
  };

  // Paste image from clipboard (Cmd+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(',')[1];
            setRefImage({ base64, mimeType: file.type, preview: dataUrl });
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  const toggleDetail = (d: string) => {
    setSelectedDetails(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };

  const handleRefUpload = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setRefImage({ base64, mimeType: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  }, []);

  const generate = async () => {
    if ((!dishName.trim() && !refImage) || generating) return;
    const n = Math.min(Math.max(count, 1), 4);
    setGenerating(true);
    setError(null);
    setProgress({ done: 0, total: n });

    const body = {
      dishName: dishName.trim(),
      model,
      resolution,
      thinkingLevel: model === 'gemini-3.1-flash-image-preview' ? thinkingLevel : '',
      mode,
      variationNotes: variationNotes.trim() || undefined,
      backgroundMode: ['full', 'isolate', 'variation'].includes(mode) ? 'solid' : bgMode,
      backgroundColor: (['full', 'isolate', 'variation'].includes(mode) || bgMode === 'solid') ? activeBg : undefined,
      angle,
      camera,
      lighting,
      details: selectedDetails.join('. '),
      composition,
      aspectRatio: ratio,
      referenceImage: refImage ? { base64: refImage.base64, mimeType: refImage.mimeType } : undefined,
    };

    type ReqResult = { ok: true; images: any[] } | { ok: false; error: string };
    const requestOne = async (variationIndex: number): Promise<ReqResult> => {
      try {
        const res = await authedFetch('/api/content/generate-asset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, variationIndex }),
        });
        const text = await res.text();
        let data: any;
        try { data = JSON.parse(text); } catch { return { ok: false, error: text || 'Generation failed' }; }
        if (!res.ok) return { ok: false, error: data.error || 'Generation failed' };
        return { ok: true, images: data.images ?? [] };
      } catch (e: any) {
        return { ok: false, error: e.message || 'Network error' };
      } finally {
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    };

    try {
      const results = await Promise.all(Array.from({ length: n }, (_, i) => requestOne(i)));
      const ts = Date.now();
      const newAssets: GeneratedAsset[] = [];
      const errors: string[] = [];
      results.forEach((r: ReqResult, i: number) => {
        if (r.ok === true) {
          r.images.forEach((img: any, j: number) => {
            newAssets.push({
              base64: img.base64,
              mimeType: img.mimeType,
              prompt: dishName.trim() || 'reference',
              timestamp: ts + i * 1000 + j,
            });
          });
        } else {
          errors.push(r.error);
        }
      });
      if (newAssets.length) {
        setAssets((prev) => [...newAssets, ...prev]);
        setSelectedIdx(0);
      }
      if (errors.length) {
        setError(
          newAssets.length
            ? `${errors.length} of ${n} request${n > 1 ? 's' : ''} failed: ${errors[0]}`
            : errors[0]
        );
      }
    } finally {
      setGenerating(false);
      setProgress({ done: 0, total: 0 });
    }
  };

  const downloadAsset = (asset: GeneratedAsset) => {
    const link = document.createElement('a');
    link.href = `data:${asset.mimeType};base64,${asset.base64}`;
    link.download = `asset-${asset.prompt.replace(/\s+/g, '-').slice(0, 30)}-${Date.now()}.png`;
    link.click();
  };

  const removeAsset = (idx: number) => {
    setAssets(prev => prev.filter((_, i) => i !== idx));
    if (selectedIdx === idx) setSelectedIdx(null);
    else if (selectedIdx !== null && selectedIdx > idx) setSelectedIdx(selectedIdx - 1);
  };

  const saveToLibrary = async (idx: number) => {
    if (!selectedAccountId || saving !== null) return;
    const asset = assets[idx];
    if (!asset) return;
    setSaving(idx);
    setError(null);
    try {
      // 1. Analyze with Gemini — identify dish, match to menu
      const menuItems = fullAccount?.menuItems?.map(m => ({
        name: m.name, category: m.category, description: m.description || undefined,
      })) || [];

      const analysisRes = await authedFetch('/api/content/analyze-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: asset.base64,
          imageMimeType: asset.mimeType,
          menuItems,
        }),
      });
      const analysis = await analysisRes.json();

      // 2. Upload to Firebase Storage
      const fileName = `${Date.now()}-${(analysis.name || 'asset').replace(/\s+/g, '-').toLowerCase()}.png`;
      const storageRef = ref(storage, `assets/${selectedAccountId}/${fileName}`);
      const bytes = Uint8Array.from(atob(asset.base64), c => c.charCodeAt(0));
      await uploadBytes(storageRef, bytes, { contentType: asset.mimeType });
      const imageUrl = await getDownloadURL(storageRef);

      // 3. Save to Firestore
      await addMediaAsset({
        accountId: selectedAccountId,
        name: analysis.name || dishName || 'Untitled Asset',
        category: analysis.category || 'Uncategorized',
        tags: analysis.tags || [],
        description: analysis.description || null,
        menuMatch: analysis.menuMatch || null,
        imageUrl,
        mimeType: asset.mimeType,
      });
    } catch (e: any) {
      setError('Save failed: ' + e.message);
    } finally {
      setSaving(null);
    }
  };

  const selected = selectedIdx !== null ? assets[selectedIdx] : null;
  const selectedAccount = accounts.find(a => a.id === selectedAccountId) || null;
  const [compareMode, setCompareMode] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const sliderContainerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const handleSliderMove = useCallback((clientX: number) => {
    const el = sliderContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setSliderPos(pct);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (draggingRef.current) handleSliderMove(e.clientX); };
    const onUp = () => { draggingRef.current = false; };
    const onTouchMove = (e: TouchEvent) => { if (draggingRef.current) handleSliderMove(e.touches[0].clientX); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [handleSliderMove]);

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Asset Sub-Tabs */}
      <div className="flex items-center gap-1 bg-[#12121A] border border-[#27273A] rounded-xl p-1 w-fit">
        {([['product', 'Product / Food'], ['title', 'Title Generator']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setAssetSubTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              assetSubTab === id
                ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {assetSubTab === 'title' ? <TitleGenerator /> : (
      <>
      {/* Food / Product Toggle */}
      <div className="flex items-center gap-1 bg-[#0A0A0F] border border-[#27273A] rounded-xl p-1 w-fit">
        {([['food', 'Food', '🍽️'], ['product', 'Products / Objects', '📦']] as const).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => {
              setAssetCategory(id);
              setMode('full');
              setAngle('');
              setSelectedDetails([]);
              setBgMode('natural');
            }}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
              assetCategory === id
                ? 'bg-gradient-to-r from-purple-600/20 to-purple-500/10 text-purple-300 border border-purple-500/30 shadow-[0_0_10px_rgba(168,85,247,0.15)]'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <span className="text-base">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Account Selector */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Select Brand</h3>
        {accountsLoading ? (
          <p className="text-sm text-zinc-600">Loading accounts...</p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-zinc-500">No accounts yet. Add one in the CRM.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {accounts.map((acct) => (
              <button
                key={acct.id}
                onClick={() => setSelectedAccountId(acct.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all border ${
                  selectedAccountId === acct.id
                    ? 'bg-purple-500/10 border-purple-500/30'
                    : 'border-[#27273A] hover:bg-[#181824]'
                }`}
              >
                <img
                  src={acct.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(acct.company)}&background=27273A&color=fff&size=28`}
                  alt="" className="w-7 h-7 rounded-lg border border-[#27273A] object-cover shrink-0"
                />
                <span className="text-xs font-medium text-white truncate max-w-[120px]">{acct.company}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Saved Asset Library */}
      {selectedAccountId && savedAssets.length > 0 && (
        <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
            Asset Library <span className="text-zinc-600">({savedAssets.length})</span>
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {savedAssets.map((asset) => (
              <div key={asset.id} className="group relative shrink-0 w-28">
                <div className="w-28 h-28 rounded-xl overflow-hidden border border-[#27273A] bg-[#0A0A0F]">
                  <img src={asset.imageUrl} alt="" className="w-full h-full object-contain" />
                </div>
                <p className="text-[10px] text-zinc-300 mt-1 truncate font-medium">{asset.name}</p>
                <p className="text-[9px] text-zinc-600 truncate">{asset.category}{asset.menuMatch ? ` · ${asset.menuMatch}` : ''}</p>
                <button
                  onClick={() => removeMediaAsset(asset.id)}
                  className="absolute top-1 right-1 p-1 rounded bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        {/* ── Left: Preview + Gallery ─────────────────── */}
        <div className="space-y-5">
          {/* Main preview */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Preview</h3>
              {selected && (
                <div className="flex items-center gap-2">
                  {selectedAccountId && (
                    <button
                      onClick={() => selectedIdx !== null && saveToLibrary(selectedIdx)}
                      disabled={saving !== null}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-purple-500/30 text-purple-300 hover:bg-purple-500/10 transition-all disabled:opacity-40"
                    >
                      {saving === selectedIdx ? <Loader size={12} className="animate-spin" /> : <Bookmark size={12} />}
                      {saving === selectedIdx ? 'Analyzing...' : 'Save to Library'}
                    </button>
                  )}
                  {canvaStatus?.connected && (
                    <button
                      onClick={() => selectedIdx !== null && sendToCanva(selectedIdx)}
                      disabled={sendingToCanva !== null}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#00C4CC]/40 text-[#00C4CC] hover:bg-[#00C4CC]/10 transition-all disabled:opacity-40"
                    >
                      {sendingToCanva === selectedIdx ? <Loader size={12} className="animate-spin" /> : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
                      )}
                      {sendingToCanva === selectedIdx ? 'Sending...' : 'Canva'}
                    </button>
                  )}
                  <button
                    onClick={() => downloadAsset(selected)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400 transition-all"
                  >
                    <Download size={12} /> Download PNG
                  </button>
                  <button
                    onClick={() => { if (selected) addToFlowBucket({ name: selected.prompt || 'Asset', base64: selected.base64, mimeType: selected.mimeType }); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 transition-all"
                    title="Add to Flow Bucket"
                  >
                    <Package size={12} /> Flow
                  </button>
                </div>
              )}
            </div>

            {/* Compare toggle */}
            {refImage && selected && !generating && (
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => setCompareMode(!compareMode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
                    compareMode
                      ? 'bg-purple-500/15 border-purple-500/30 text-purple-300'
                      : 'border-[#27273A] text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Before / After
                </button>
              </div>
            )}

            {/* Preview area */}
            {compareMode && refImage && selected ? (
              /* ── Before/After Slider ──────────────── */
              <div
                ref={sliderContainerRef}
                className="relative rounded-xl overflow-hidden border border-[#27273A] mx-auto cursor-col-resize select-none"
                style={{ maxWidth: 520, aspectRatio: ratio.replace(':', '/') }}
                onMouseDown={(e) => { draggingRef.current = true; handleSliderMove(e.clientX); }}
                onTouchStart={(e) => { draggingRef.current = true; handleSliderMove(e.touches[0].clientX); }}
              >
                {/* After (generated) — full width underneath */}
                <img
                  src={`data:${selected.mimeType};base64,${selected.base64}`}
                  alt="After"
                  className="absolute inset-0 w-full h-full object-cover"
                />

                {/* Before (reference) — clipped by slider */}
                <div className="absolute inset-0 overflow-hidden" style={{ width: `${sliderPos}%` }}>
                  <img
                    src={refImage.preview}
                    alt="Before"
                    style={{ width: sliderContainerRef.current?.offsetWidth || '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>

                {/* Slider line + handle */}
                <div
                  className="absolute top-0 bottom-0 z-10"
                  style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
                >
                  <div className="w-0.5 h-full bg-white shadow-[0_0_8px_rgba(0,0,0,0.5)]" />
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center">
                    <div className="flex items-center gap-0.5 text-zinc-600">
                      <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor"><path d="M6 0L0 6l6 6V0z"/></svg>
                      <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor"><path d="M2 0l6 6-6 6V0z"/></svg>
                    </div>
                  </div>
                </div>

                {/* Labels */}
                <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-black/60 text-[10px] text-white font-medium z-10">Before</div>
                <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-black/60 text-[10px] text-white font-medium z-10">After</div>
              </div>
            ) : (
              /* ── Standard Preview ─────────────────── */
              <div className="flex gap-4">
                {refImage && !generating && (
                  <div className="shrink-0">
                    <p className="text-[10px] text-zinc-500 mb-1.5">Reference</p>
                    <div className="w-32 h-32 rounded-xl overflow-hidden border border-[#27273A] bg-[#0A0A0F]">
                      <img src={refImage.preview} alt="" className="w-full h-full object-cover" />
                    </div>
                  </div>
                )}
                <div className="flex-1">
                  {refImage && !generating && <p className="text-[10px] text-zinc-500 mb-1.5">Result</p>}
                  <div
                    className="rounded-xl overflow-hidden border border-[#27273A] flex items-center justify-center mx-auto"
                    style={{ maxWidth: 520, aspectRatio: ratio.replace(':', '/'), backgroundColor: selected ? (['full', 'isolate', 'variation'].includes(mode) || bgMode === 'solid' ? activeBg : '#0A0A0F') : '#0A0A0F' }}
                  >
                    {generating ? (
                      <div className="flex flex-col items-center gap-3 py-16">
                        <Loader size={32} className="text-purple-400 animate-spin" />
                        <p className="text-sm text-zinc-400">Generating with {MODELS.find(m => m.id === model)?.label ?? 'AI'}...</p>
                        <p className="text-[10px] text-zinc-600">This may take 15-30 seconds</p>
                      </div>
                    ) : selected ? (
                      <img
                        src={`data:${selected.mimeType};base64,${selected.base64}`}
                        alt=""
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3 py-16 text-zinc-600">
                        <Image size={40} strokeWidth={1} />
                        <p className="text-sm">Upload a reference photo or describe a dish</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Gallery */}
          {assets.length > 0 && (
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
                Generated Assets <span className="text-zinc-600">({assets.length})</span>
              </h3>
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                {assets.map((asset, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedIdx(idx)}
                    className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                      selectedIdx === idx
                        ? 'border-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                        : 'border-[#27273A] hover:border-zinc-600'
                    }`}
                  >
                    <div className="aspect-square" style={{ backgroundColor: '#f5f5f5' }}>
                      <img src={`data:${asset.mimeType};base64,${asset.base64}`} alt="" className="w-full h-full object-contain" />
                    </div>
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {selectedAccountId && (
                        <button
                          onClick={(e) => { e.stopPropagation(); saveToLibrary(idx); }}
                          className="p-1 rounded bg-purple-600/90 text-white"
                          title="Save to Library"
                        >
                          {saving === idx ? <Loader size={10} className="animate-spin" /> : <Bookmark size={10} />}
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeAsset(idx); }}
                        className="p-1 rounded bg-black/70 text-white"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* ── Right: Controls ─────────────────────────── */}
        <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-200px)] pr-1">
          {/* Reference Image Upload */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Reference Photo</h3>
            {refImage ? (
              <div
                className={`relative group rounded-xl border-2 transition-all ${flowDrop.dragOver ? 'border-amber-400' : 'border-transparent'}`}
                onDragOver={flowDrop.handleDragOver}
                onDragLeave={flowDrop.handleDragLeave}
                onDrop={flowDrop.handleDrop}
              >
                <img src={refImage.preview} alt="" className="w-full h-36 rounded-xl object-cover border border-[#27273A]" />
                {flowDrop.dragOver && (
                  <div className="absolute inset-0 bg-amber-500/20 rounded-xl flex items-center justify-center">
                    <span className="text-xs text-amber-300 font-medium bg-black/60 px-3 py-1.5 rounded-lg">Drop to replace</span>
                  </div>
                )}
                <button onClick={() => setRefImage(null)} className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={flowDrop.handleDragOver}
                onDragLeave={flowDrop.handleDragLeave}
                onDrop={flowDrop.handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  flowDrop.dragOver ? 'border-amber-400 bg-amber-500/10' : 'border-[#27273A] hover:border-zinc-600 hover:bg-[#0A0A0F]'
                }`}
              >
                <Upload size={24} className="mx-auto mb-2 text-zinc-500" />
                <p className="text-xs text-zinc-400">{assetCategory === 'food' ? 'Upload a food photo' : 'Upload a product photo'}</p>
                <p className="text-[10px] text-zinc-600 mt-1">Any quality — AI will enhance it</p>
                <p className="text-[10px] text-zinc-500 mt-2">
                  or press <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a2e] border border-[#27273A] text-zinc-400 font-mono text-[9px]">&#8984;V</kbd> to paste from clipboard
                </p>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleRefUpload(e.target.files)} />
            {refImage && !['full', 'isolate', 'variation'].includes(mode) && (
              <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <p className="text-[10px] text-emerald-300">
                  <span className="font-semibold">Enhancement Mode</span> — AI will professionally restyle your photo with the selected look. Expect a visible, dramatic improvement.
                </p>
              </div>
            )}
          </div>

          {/* Dish / Product Name */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">{assetCategory === 'food' ? 'Dish Name' : 'Product Name'}</h3>
            <input
              value={dishName}
              onChange={(e) => setDishName(e.target.value)}
              placeholder={assetCategory === 'food' ? 'e.g. Fettuccine Alfredo with grilled chicken' : 'e.g. Wireless Bluetooth Headphones, matte black'}
              className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors"
            />
          </div>

          {/* Mode */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
              {refImage ? 'Style' : 'Mode'}
            </h3>
            {refImage && (
              <p className="text-[10px] text-zinc-500 mb-2.5">
                Styles will dramatically restyle your photo. <span className="text-amber-400">Isolate</span>, <span className="text-amber-400">Variation</span>, and <span className="text-amber-400">Full Asset</span> will regenerate it.
              </p>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {(assetCategory === 'food' ? FOOD_MODES : PRODUCT_MODES).map((m) => {
                const isTransform = ['full', 'isolate', 'variation'].includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`px-2 py-2.5 rounded-xl border text-center transition-all ${
                      mode === m.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                    } ${(m as any).requiresRef && !refImage ? 'opacity-50' : ''} ${refImage && isTransform ? 'ring-1 ring-amber-500/20' : ''}`}
                  >
                    <p className={`text-[11px] font-semibold ${mode === m.id ? 'text-purple-300' : refImage && isTransform ? 'text-amber-300/70' : 'text-zinc-300'}`}>{m.label}</p>
                    <p className="text-[8px] text-zinc-500 mt-0.5 leading-tight">{refImage && isTransform ? (m.id === 'full' ? 'Regenerate on solid bg' : m.sub) : m.sub}</p>
                  </button>
                );
              })}
            </div>
            {['isolate', 'variation', 'subtle-variations'].includes(mode) && !refImage && (
              <p className="text-[10px] text-amber-400 mt-2">Upload a reference photo above to use this mode</p>
            )}
          </div>

          {/* Variation Notes */}
          {mode === 'variation' && (
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Variation Notes</h3>
              <textarea
                value={variationNotes}
                onChange={(e) => setVariationNotes(e.target.value)}
                placeholder="Describe what to change...&#10;e.g. More cheese on top, darker sauce, different plate, add garnish, make it a smaller portion"
                rows={3}
                className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none resize-none focus:border-purple-500/40 transition-colors"
              />
              <p className="text-[9px] text-zinc-600 mt-1.5">Leave empty for AI to make creative choices</p>
            </div>
          )}

          {/* Model */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">AI Model</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  className={`px-3 py-3 rounded-xl border text-center transition-all ${
                    model === m.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                  }`}
                >
                  <p className={`text-[12px] font-semibold ${model === m.id ? 'text-purple-300' : 'text-zinc-300'}`}>{m.label}</p>
                  <p className="text-[9px] text-zinc-500 mt-0.5">{m.sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Resolution</h3>
            <div className="flex gap-1.5">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setResolution(r.id)}
                  className={`flex-1 py-2 rounded-xl border text-center transition-all ${
                    resolution === r.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                  }`}
                >
                  <p className={`text-[12px] font-semibold ${resolution === r.id ? 'text-purple-300' : 'text-zinc-300'}`}>{r.label}</p>
                  <p className="text-[9px] text-zinc-500">{r.sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Thinking Mode (Flash only) */}
          {model === 'gemini-3.1-flash-image-preview' && (
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Thinking Mode</h3>
              <div className="flex gap-1.5">
                {THINKING_LEVELS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setThinkingLevel(t.id)}
                    className={`flex-1 py-2 rounded-xl border text-center transition-all ${
                      thinkingLevel === t.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                    }`}
                  >
                    <p className={`text-[12px] font-semibold ${thinkingLevel === t.id ? 'text-purple-300' : 'text-zinc-300'}`}>{t.label}</p>
                    <p className="text-[9px] text-zinc-500">{t.sub}</p>
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-zinc-600 mt-2">Thinking mode lets the AI reason about composition and accuracy before generating</p>
            </div>
          )}

          {/* Background — only show when NOT in enhancement mode */}
          {!(refImage && !['full', 'isolate', 'variation'].includes(mode)) && (
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Background</h3>
              {['full', 'isolate', 'variation'].includes(mode) ? (
                <p className="text-[10px] text-zinc-500 mb-3">This mode always uses a solid color background</p>
              ) : (
                <div className="flex items-center gap-1 bg-[#0A0A0F] rounded-lg p-0.5 mb-3">
                  <button
                    onClick={() => setBgMode('natural')}
                    className={`flex-1 px-3 py-2 rounded-md text-[11px] font-medium transition-all text-center ${
                      bgMode === 'natural'
                        ? 'bg-purple-500/15 text-purple-300'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Natural Scene
                  </button>
                  <button
                    onClick={() => setBgMode('solid')}
                    className={`flex-1 px-3 py-2 rounded-md text-[11px] font-medium transition-all text-center ${
                      bgMode === 'solid'
                        ? 'bg-purple-500/15 text-purple-300'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Solid Color
                  </button>
                </div>
              )}
              {(['full', 'isolate', 'variation'].includes(mode) || bgMode === 'solid') && (
                <>
                  <div className="grid grid-cols-5 gap-1.5 mb-3">
                    {BG_COLORS.map((c) => (
                      <button
                        key={c.hex}
                        onClick={() => { setBgColor(c.hex); setCustomBg(''); }}
                        title={c.name}
                        className={`aspect-square rounded-lg border-2 transition-all ${
                          bgColor === c.hex && !customBg
                            ? 'border-purple-400 scale-110 shadow-[0_0_8px_rgba(168,85,247,0.3)]'
                            : 'border-transparent hover:border-zinc-600 hover:scale-105'
                        }`}
                        style={{ backgroundColor: c.hex }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="color" value={customBg || bgColor} onChange={(e) => setCustomBg(e.target.value)} className="w-8 h-8 rounded-lg border border-[#27273A] cursor-pointer bg-transparent" />
                    <input value={customBg || bgColor} onChange={(e) => setCustomBg(e.target.value)} placeholder="#FFFFFF" className="flex-1 bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-1.5 text-xs text-white font-mono placeholder-zinc-600 outline-none focus:border-purple-500/40" />
                  </div>
                </>
              )}
              {bgMode === 'natural' && !['full', 'isolate', 'variation'].includes(mode) && (
                <p className="text-[10px] text-zinc-500">AI will generate a realistic scene background</p>
              )}
            </div>
          )}

          {/* Angle */}
          {(() => {
            const shotTypeActive = assetCategory === 'food' && SHOT_TYPE_MODES.has(mode);
            const baseAngles = assetCategory === 'food' ? FOOD_ANGLES : PRODUCT_ANGLES;
            const visibleAngles = shotTypeActive
              ? (FOOD_ANGLES as typeof FOOD_ANGLES).filter((a) => a.compatibleWithShotType)
              : baseAngles;
            return (
              <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Angle</h3>
                  {shotTypeActive && (
                    <span className="text-[10px] text-zinc-500">Framing set by shot type · showing modifiers only</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {visibleAngles.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setAngle(a.id)}
                      className={`px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                        angle === a.id ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Camera / Lens */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Camera & Lens</h3>
              {(cameraBody || lensType || fStop || shutterSpeed || isoSetting) && (
                <button
                  onClick={() => { setCameraBody(''); setLensType(''); setFStop(''); setShutterSpeed(''); setIsoSetting(''); }}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase tracking-wider"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Camera Body */}
            <div>
              <h4 className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-2">Camera Body</h4>
              <div className="flex flex-wrap gap-1.5">
                {CAMERA_BODIES.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCameraBody(c.id)}
                    className={`px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                      cameraBody === c.id ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Lens Type */}
            <div>
              <h4 className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-2">Lens Type</h4>
              <div className="flex flex-wrap gap-1.5">
                {LENS_TYPES.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLensType(l.id)}
                    className={`px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                      lensType === l.id ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {/* F-Stop */}
            <div>
              <h4 className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-2">F-Stop (Aperture)</h4>
              <div className="flex flex-wrap gap-1.5">
                {F_STOPS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFStop(f.id)}
                    className={`px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                      fStop === f.id ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Shutter Speed */}
            <div>
              <h4 className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-2">Shutter Speed</h4>
              <div className="flex flex-wrap gap-1.5">
                {SHUTTER_SPEEDS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setShutterSpeed(s.id)}
                    className={`px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                      shutterSpeed === s.id ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ISO */}
            <div>
              <h4 className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-2">ISO</h4>
              <div className="flex flex-wrap gap-1.5">
                {ISO_SETTINGS.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => setIsoSetting(i.id)}
                    className={`px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                      isoSetting === i.id ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Lighting */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Lighting</h3>
            <div className="flex flex-wrap gap-1.5">
              {LIGHTING_OPTIONS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLighting(l.id)}
                  className={`px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                    lighting === l.id ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Details (multi-select) */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Details <span className="text-zinc-600 normal-case">(multi-select)</span></h3>
            <div className="flex flex-wrap gap-1.5">
              {(assetCategory === 'food' ? FOOD_DETAILS : PRODUCT_DETAILS).map((d) => (
                <button
                  key={d.id}
                  onClick={() => toggleDetail(d.id)}
                  className={`px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                    selectedDetails.includes(d.id) ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Composition — hidden in enhancement mode */}
          {!(refImage && !['full', 'isolate', 'variation'].includes(mode)) && (
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Composition</h3>
            <div className="flex flex-wrap gap-1.5">
              {COMPOSITION_OPTIONS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setComposition(c.id)}
                  className={`px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                    composition === c.id ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* Ratio */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Aspect Ratio</h3>
            <div className="flex gap-1.5">
              {RATIOS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRatio(r.id)}
                  className={`flex-1 py-2 rounded-xl border text-center transition-all ${
                    ratio === r.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                  }`}
                >
                  <p className={`text-[11px] font-medium ${ratio === r.id ? 'text-purple-300' : 'text-zinc-300'}`}>{r.label}</p>
                  <p className="text-[9px] text-zinc-500">{r.sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Canva Connection */}
          {canvaStatus?.configured && (
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#00C4CC"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" fill="none"/></svg>
                  <div>
                    <p className="text-[11px] font-medium text-white">Canva</p>
                    <p className="text-[9px] text-zinc-500">
                      {canvaStatus.connected ? 'Connected — assets will sync' : 'Send assets directly to Canva'}
                    </p>
                  </div>
                </div>
                {canvaStatus.connected ? (
                  <button
                    onClick={async () => { await authedFetch('/api/canva/disconnect', { method: 'POST' }); setCanvaStatus({ ...canvaStatus, connected: false }); }}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={connectCanva}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-[#00C4CC] text-white hover:bg-[#00b0b8] transition-colors"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Generate Button */}
          <div className="sticky bottom-0 bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Count</h3>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    disabled={generating}
                    className={`w-9 h-9 rounded-lg border text-xs font-medium transition-all ${
                      count === n
                        ? 'bg-purple-500/15 border-purple-500/40 text-purple-200'
                        : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={generate}
              disabled={generating || (['isolate', 'variation', 'subtle-variations'].includes(mode) ? !refImage : (!dishName.trim() && !refImage))}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {generating ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  {refImage && !['full', 'isolate', 'variation'].includes(mode) ? 'Enhancing' : 'Generating'}
                  {progress.total > 1 ? ` ${progress.done}/${progress.total}…` : '…'}
                </>
              ) : (
                <>
                  <Plus size={14} />
                  {refImage && !['full', 'isolate', 'variation'].includes(mode) ? 'Enhance Photo' : 'Generate Asset'}
                  {count > 1 ? ` × ${count}` : ''}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
