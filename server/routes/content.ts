import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import db, { schema } from "../db/index.js";
import { eq } from "drizzle-orm";

const router = Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const VALID_RATIOS = [
  "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9",
] as const;
type AspectRatio = (typeof VALID_RATIOS)[number];

router.post("/generate-image", async (req, res) => {
  try {
    const {
      prompt,
      aspectRatio = "1:1",
    } = req.body as {
      prompt: string;
      aspectRatio?: AspectRatio;
    };

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "A prompt is required." });
    }

    if (!VALID_RATIOS.includes(aspectRatio as AspectRatio)) {
      return res
        .status(400)
        .json({ error: `Invalid aspect ratio. Use: ${VALID_RATIOS.join(", ")}` });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: prompt.trim(),
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: aspectRatio as AspectRatio,
        },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const images: { base64: string; mimeType: string }[] = [];

    for (const part of parts) {
      if ((part as any).inlineData) {
        images.push({
          base64: (part as any).inlineData.data,
          mimeType: (part as any).inlineData.mimeType || "image/png",
        });
      }
    }

    if (images.length === 0) {
      return res.status(422).json({ error: "No image was generated. Try a different prompt." });
    }

    res.json({ images });
  } catch (err: any) {
    console.error("Image generation error:", err?.message || err);
    let userMessage = "Failed to generate image.";
    let statusCode = 500;

    if (err?.status && typeof err.status === "number") {
      statusCode = err.status;
    }

    if (err?.message) {
      try {
        const parsed = JSON.parse(err.message);
        userMessage = parsed?.error?.message || err.message;
      } catch {
        userMessage = err.message;
      }
    }

    res.status(statusCode).json({ error: userMessage });
  }
});

// ─── Background Extraction (remove subject, keep background) ─

router.post("/extract-background", async (req, res) => {
  try {
    const {
      image,
      aspectRatio = "1:1",
    } = req.body as {
      image: { base64: string; mimeType: string };
      aspectRatio?: AspectRatio;
    };

    if (!image?.base64) {
      return res.status(400).json({ error: "An image is required." });
    }

    if (!VALID_RATIOS.includes(aspectRatio as AspectRatio)) {
      return res.status(400).json({ error: `Invalid aspect ratio. Use: ${VALID_RATIOS.join(", ")}` });
    }

    const prompt = `Look at this image carefully. There is a subject in the foreground (a person, object, product, animal, food, etc.).

Your task: REMOVE the subject entirely and produce a clean version of ONLY the background/scene — as if the subject was never there.

CRITICAL RULES:
- Completely erase the subject from the image — no trace of it should remain
- Intelligently fill in the area where the subject was, seamlessly continuing the background's textures, colors, patterns, lighting, and perspective so it looks completely natural
- Preserve every detail of the original background — same colors, same lighting, same mood, same textures, same environment
- The result should look like a real photograph of the scene/location/surface WITHOUT any subject in it
- If the background extends beyond the original frame to fit the requested aspect ratio, extend it naturally and seamlessly — same style, same environment, same lighting
- The final image must be ultra-realistic and usable as a standalone background for other projects
- Do NOT add any new objects, watermarks, or text — just the clean, empty background/scene`;

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: image.base64, mimeType: image.mimeType } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: aspectRatio as AspectRatio,
        },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const images: { base64: string; mimeType: string }[] = [];

    for (const part of parts) {
      if ((part as any).inlineData) {
        images.push({
          base64: (part as any).inlineData.data,
          mimeType: (part as any).inlineData.mimeType || "image/png",
        });
      }
    }

    if (images.length === 0) {
      return res.status(422).json({ error: "Could not extract background. Try a different image." });
    }

    res.json({ images });
  } catch (err: any) {
    console.error("Background extraction error:", err?.message || err);
    let userMessage = "Failed to extract background.";
    let statusCode = 500;
    if (err?.status && typeof err.status === "number") statusCode = err.status;
    if (err?.message) {
      try { userMessage = JSON.parse(err.message)?.error?.message || err.message; } catch { userMessage = err.message; }
    }
    res.status(statusCode).json({ error: userMessage });
  }
});

// ─── Asset Generation (reference image → polished render) ─

router.post("/generate-asset", async (req, res) => {
  try {
    const {
      dishName = "",
      model = "gemini-3-pro-image-preview",
      resolution = "1K",
      thinkingLevel = "",
      mode = "full",
      variationNotes = "",
      backgroundMode = "natural",
      backgroundColor = "#FFFFFF",
      angle = "",
      camera = "",
      lighting = "",
      details = "",
      composition = "",
      aspectRatio = "1:1",
      referenceImage,
    } = req.body as {
      dishName?: string;
      model?: string;
      resolution?: string;
      thinkingLevel?: string;
      mode?: string;
      variationNotes?: string;
      backgroundMode?: "natural" | "solid";
      backgroundColor?: string;
      angle?: string;
      camera?: string;
      lighting?: string;
      details?: string;
      composition?: string;
      aspectRatio?: AspectRatio;
      referenceImage?: { base64: string; mimeType: string };
    };

    const allowedModels = ["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"];
    const selectedModel = allowedModels.includes(model) ? model : "gemini-3-pro-image-preview";
    const allowedRes = ["512", "1K", "2K", "4K"];
    const selectedRes = allowedRes.includes(resolution) ? resolution : "1K";

    if ((mode === "isolate" || mode === "variation") && !referenceImage) {
      return res.status(400).json({ error: "A reference image is required for this mode." });
    }
    if (!dishName?.trim() && !referenceImage) {
      return res.status(400).json({ error: "Provide a dish name or upload a reference image." });
    }

    if (!VALID_RATIOS.includes(aspectRatio as AspectRatio)) {
      return res.status(400).json({ error: "Invalid aspect ratio." });
    }

    // Modes that intentionally transform the image (not enhancement)
    const transformModes = ["full", "isolate", "variation"];
    const isEnhanceMode = !!referenceImage && !transformModes.includes(mode);

    const solidBgRule = `The background must be a perfectly solid, uniform ${backgroundColor} with ZERO gradients, shadows, textures, or reflections. Clean edges suitable for background removal.`;

    // ── ENHANCEMENT STYLE MAP ─────────────────────────────
    // When a reference image is provided and mode is NOT a transform mode,
    // we treat it as a photo enhancement — same food, same scene, different styling.
    const enhanceStyles: Record<string, string> = {
      // Food styles
      "macro":         "Transform into an extreme close-up macro shot. Crank sharpness to reveal every grain, droplet, seed, and fiber in hyper-detail. Blow out the background into gorgeous creamy bokeh. The textures should be so vivid the viewer can almost taste and feel the food.",
      "lifestyle":     "Transform into a warm, golden-hour lifestyle shot. Flood the scene with warm ambient light, add a soft golden glow, enrich warm tones dramatically. The scene should feel like a beautiful moment at a cozy restaurant — inviting, atmospheric, and magazine-worthy.",
      "flat-lay":      "Transform into a crisp, perfectly-lit overhead flat-lay. Brighten aggressively, eliminate all harsh shadows, make every color pop with vibrant saturation. The result should look like a professionally styled Instagram flat-lay with perfect even lighting.",
      "editorial":     "Transform into a premium magazine-cover editorial shot. Perfect every detail — flawless color balance, razor-sharp clarity, sophisticated toning, and remove any visual imperfections. This should look like it was shot for Bon Appétit or Vogue with a $50K camera setup.",
      "dark-moody":    "Transform into a dramatic dark and moody image. Crush the shadows deep, create rich chiaroscuro contrast, and make the food emerge from darkness with selective dramatic highlights. Think Renaissance still-life painting — deep, rich, theatrical. The atmosphere should shift drastically darker.",
      "bright-airy":   "Transform into a bright, high-key, luminous image. Blast the exposure up, flood everything with soft diffused light, make whites glow and colors feel pastel-fresh. The entire mood should shift to feel clean, ethereal, and sun-drenched — a completely different energy from the original.",
      "action":        "Transform into a high-energy action shot. Add visible motion blur to background elements, make steam/drips/movement look explosive and dynamic. Boost contrast hard on the food and freeze-frame any motion with dramatic intensity. The image should feel kinetic and alive.",
      "rustic":        "Transform into a rich farmhouse rustic aesthetic. Shift the entire color palette to deep warm earth tones — burnt oranges, rich browns, muted greens. Add a strong warm vignette around the edges. The image should feel like it was taken in a candlelit countryside kitchen.",
      "minimalist":    "Transform with aggressive minimalist processing. Strip away visual noise, dramatically simplify the tonal range, push toward a refined monochromatic palette. The negative space should feel intentional and elegant — a gallery-worthy, less-is-more aesthetic.",
      "street-food":   "Transform into gritty, high-energy street food photography. Crank up contrast hard, boost saturation on the food to pop, add urban grittiness and documentary energy. The image should feel raw, authentic, and bursting with street-level intensity.",
      "fine-dining":   "Transform into ultra-polished fine-dining photography. Perfect the white balance completely, create creamy luxurious highlights, apply pristine clarity to every detail. The image should look like it came from a Michelin-starred restaurant's marketing team — every pixel perfect.",
      "ingredients":   "Transform to showcase each ingredient with vivid, hyper-real clarity. Crank sharpness and color vibrancy to make every component — every leaf, every grain, every droplet — burst with freshness and visual impact. Each element should look impossibly crisp and appetizing.",
      "process":       "Transform into an atmospheric kitchen-action shot. Add warm smoky haze, shift to rich warm amber tones, and create a sense of heat and craft. The image should feel like a behind-the-scenes documentary moment — authentic, warm, and full of kitchen energy.",
      "portrait":      "Transform into a dramatic food portrait. Create intense creamy background bokeh, sharpen the subject to razor precision, add dramatic rim lighting, and make the dish feel like the star of a movie poster. Shallow depth-of-field should be extreme and beautiful.",
      "steam-sizzle":  "Transform to radiate heat and freshness. Add or amplify visible steam rising, create a warm atmospheric glow around the food, boost warm highlights intensely. The food should look sizzling hot, just-plated, with visible heat energy radiating off it.",
      "messy":         "Transform into raw, beautifully imperfect food photography. Warm up tones, emphasize real textures — crumbs, sauce drips, imperfect bites. Add a candid, unposed quality with warm tones and soft focus. Deliciously messy and human.",
      "table-spread":  "Transform into a warm, abundant feast scene. Even out the lighting across everything, push warm inviting tones, make every item on the table look irresistible. The scene should feel like a generous, communal celebration of food.",
      "smoke-fire":    "Transform into an intense smoke-and-fire shot. Push warm oranges and deep reds hard, add visible smoky haze and atmosphere, intensify charred textures and grill marks with high contrast. The image should feel primal, bold, and fiercely appetizing.",
      "drizzle-pour":  "Transform to emphasize liquid and sauce drama. Make every droplet razor-sharp, add intense highlights and shine to wet surfaces, create a glistening, dynamic quality. Sauces and liquids should look thick, luxurious, and impossibly appetizing.",
      "stack-tower":   "Transform to emphasize dramatic height and layers. Boost contrast between layers aggressively, add depth and dimension, create a sense of towering abundance. The vertical composition should feel grand, indulgent, and visually striking.",
      "bokeh":         "Transform with extreme shallow depth-of-field. Keep the food tack-sharp but dissolve the entire background into gorgeous, creamy bokeh circles with warm light orbs. The effect should be dramatic and dreamy — like shooting wide open at f/1.2.",
      "noir":          "Transform into striking black and white with aggressive film noir contrast. Deep rich blacks, bright punchy highlights, dramatic tonal range. Strip all color and replace with pure artistic monochrome drama. The difference should be unmistakable.",
      "neon-night":    "Transform into a vibrant neon-lit nightlife scene. Shift the entire color palette toward electric pinks, blues, and purples. Add visible neon reflections and colored light on all surfaces. The image should feel like late-night urban dining under neon signs — a complete mood shift.",
      "deconstructed": "Transform with ultra-precise analytical clarity. Boost separation between every element, crank sharpness to maximum, make each individual texture and component distinct and defined. The image should feel both scientific and artistic — revealing the anatomy of the dish.",
      "comfort-cozy":  "Transform into a warm, enveloping comfort-food scene. Drench everything in warm oranges and soft yellows, add a strong warm vignette, soften the overall feel. The image should radiate warmth and nostalgia — like a cozy Sunday evening at home.",
      "frozen-ice":    "Transform into a cold, crisp, icy scene. Shift the entire palette toward cool blues and frosty whites, enhance any frost or condensation textures dramatically, create a refreshingly cold and crystalline atmosphere. The temperature shift should be visually obvious.",
      "charcuterie":   "Transform into a richly detailed spread photograph. Perfect the lighting across every item, make colors vivid and jewel-toned, sharpen every texture — the grain of the cheese, the marbling of the meat, the sheen of the olives. Abundant, curated, and luxurious.",
      // Product styles
      "hero":          "Transform into a powerful hero shot. Add dramatic contrast, create bold rim lighting, deepen shadows for depth, and make the product command the frame with authority. Premium, powerful, and impossible to ignore.",
      "group":         "Transform into a perfectly cohesive collection shot. Balance lighting evenly across all products, create color harmony, and ensure each item is equally well-lit and sharp. Professional catalog quality with visual unity.",
      "scale":         "Transform with maximum clarity and precision. Sharpen everything, create clean even lighting, and make the product and its context objects crystal clear. Informative, professional, and immediately readable.",
      "detail-texture":"Transform into extreme textural close-up. Crank micro-contrast and clarity to reveal every fiber, stitch, grain, and material detail. The surface texture should be the undeniable star — so detailed you can feel the material through the screen.",
      "packaging":     "Transform into retail-ready packaging photography. Make colors crisp and true, text razor-sharp, and surfaces clean and polished. The packaging should look premium, professional, and ready for a product listing page.",
      "in-use":        "Transform into warm, aspirational lifestyle photography. Add golden warm tones, natural ambient glow, and make the product-in-use moment feel beautiful, relatable, and desirable. The kind of shot that makes people want what they see.",
      "studio":        "Transform into clean, professional studio catalog photography. Even white lighting, zero color cast, maximum sharpness, and pristine product accuracy. The gold standard for e-commerce product shots.",
      "exploded":      "Transform with aggressive clarity on each separate component. Boost separation, sharpen edges, and make every piece pop against the background with distinct visual identity. Technical precision meets visual drama.",
      "floating":      "Transform to amplify the floating/dynamic quality. Deepen the shadow beneath, add dramatic lighting from above, sharpen the product to perfection, and create a sense of weightless energy and motion.",
      "splash-action": "Transform into explosive frozen-motion photography. Sharpen every droplet to crystal clarity, boost contrast on all moving elements, and add maximum energy and dynamism. The image should feel like a perfectly timed high-speed shot.",
      "neon-glow":     "Transform into cyberpunk neon aesthetics. Add vibrant edge lighting in electric pinks, blues, and purples, create colored reflections on all surfaces, and shift the entire mood to futuristic and high-tech. The color shift should be dramatic.",
      "luxury":        "Transform into ultra-premium luxury photography. Enrich with deep, sumptuous tones, add warm golden highlights, create velvet-smooth tonal transitions. Every surface should look expensive and exclusive — this is high-end lifestyle.",
      "reflection":    "Transform to maximize reflective beauty. Intensify specular highlights, sharpen mirror reflections, add depth and visual richness through polished surfaces. The image should feel elegant, refined, and visually deep.",
      "silhouette":    "Transform into dramatic backlit silhouette photography. Darken the subject's front aggressively, create strong rim/edge lighting, and define a striking outline against the background. Mysterious, artistic, and bold.",
      "color-pop":     "Transform by cranking the product's dominant color to maximum vibrancy while desaturating everything else. The product should explode with color against a muted background — impossible to look away from.",
      "shadow-play":   "Transform with dramatic shadow artistry. Intensify all shadow patterns, create deep contrast, and make light-and-shadow the visual story. The atmosphere should shift to moody, dramatic, and visually compelling.",
      "outdoor-nature":"Transform into vibrant outdoor nature photography. Boost greens and natural earth tones aggressively, add fresh outdoor light quality with warmth and depth. The product should feel perfectly at home in a lush natural setting.",
    };

    // Build prompt based on mode
    let prompt: string;
    const dish = dishName.trim() || "this item";

    if (isEnhanceMode) {
      // ── ENHANCEMENT PATH ─────────────────────────────────
      // Reference image is present, mode is NOT a transform mode.
      // Goal: Visibly enhance and restyle the photo — the result should look noticeably better/different.
      const styleDesc = enhanceStyles[mode] || "Dramatically improve the overall image quality — boost sharpness, enrich colors, perfect the lighting, and add professional polish. The result should look noticeably better than the original.";

      prompt = `You are an expert food and product photographer doing a professional reshoot and retouch. You're given a real photograph — your job is to make it look DRAMATICALLY better by applying a strong photographic style.

YOUR TASK: Transform this photo into a stunning, professional-grade image. Apply the requested style BOLDLY — the viewer should immediately see a clear difference between the original and your result.

GUIDELINES:
- Keep the same subject (the food/product shown) recognizable — don't swap it for something else
- Keep the same general scene and setting — but you CAN and SHOULD improve it: clean up distractions, perfect the lighting, enhance textures, boost colors, add atmosphere, improve the overall look
- You CAN adjust the lighting significantly — add dramatic shadows, warm glows, studio-quality light, rim lighting, etc.
- You CAN enhance textures — make food look more appetizing, surfaces more interesting, materials more tactile
- You CAN shift the color palette aggressively to match the requested style
- You CAN add atmosphere — steam, bokeh, light rays, depth-of-field effects, ambient glow
- You CAN polish the scene — remove imperfections, clean surfaces, make everything look premium
- The result should look like a professional photographer re-shot and retouched this image — NOT like someone applied a subtle filter
- Make the change VISIBLE and IMPACTFUL. If someone compares before/after side-by-side, the difference should be obvious and impressive

STYLE TO APPLY (go bold with this):
${styleDesc}

${dishName.trim() ? `The subject is: ${dishName.trim()}.` : ""}`;

    } else {
      // ── GENERATION / TRANSFORM PATH ──────────────────────
      // No reference image, OR mode is isolate/variation/full.
      const useSolidBg = transformModes.includes(mode) || backgroundMode === "solid";
      const sceneBgRule = "The background must be a realistic environment or scene — do NOT use a solid color, flat, or plain background.";
      const bgInstruction = useSolidBg ? solidBgRule : sceneBgRule;

      switch (mode) {
        case "isolate":
          prompt = `Look at this reference image carefully. Identify the exact food item, dish, or product shown. Now recreate this EXACT item — same dish, same plating, same garnishes, same proportions, same colors — as a full in-frame ultra-realistic 4K photograph. Render it completely isolated against a perfectly solid, uniform ${backgroundColor} background. ${solidBgRule} Only the food/product should be visible. Match the reference as closely as possible in every detail.`;
          break;
        case "variation":
          prompt = `Look at this reference image carefully. Identify the food item, dish, or product shown. Now create a VARIATION inspired by this reference — similar type but with creative differences. ${variationNotes ? `The user wants these specific changes: ${variationNotes}.` : "Apply creative variations in styling, arrangement, or presentation while keeping it the same category."} Render it as a full in-frame ultra-realistic 4K photograph against a perfectly solid, uniform ${backgroundColor} background. ${solidBgRule}`;
          break;
        case "full":
          prompt = `Create a full in-frame ultra-realistic 4K photo of ${dish}, fully rendered against a solid ${backgroundColor} background. ${solidBgRule}`;
          break;

        case "macro":
          prompt = `Create an ultra-realistic 4K macro shot of ${dish}. Extreme close-up showing every texture, droplet, and detail. Shallow depth of field, the subject should fill the entire frame. ${bgInstruction}`;
          break;
        case "lifestyle":
          prompt = `Create an ultra-realistic 4K lifestyle photograph of ${dish} in a natural, lived-in setting. Show it on a real table with authentic props like napkins, utensils, drinks, and ambient surroundings. The scene should feel warm, inviting, and candid. ${bgInstruction}`;
          break;
        case "flat-lay":
          prompt = `Create an ultra-realistic 4K flat lay photograph of ${dish} shot directly from above. Artfully arranged on a styled surface with complementary props and garnishes scattered intentionally around it. Clean, organized, Instagram-worthy overhead composition. ${bgInstruction}`;
          break;
        case "editorial":
          prompt = `Create a magazine-quality ultra-realistic 4K editorial photograph of ${dish}. Impeccable styling with perfect placement, sophisticated backdrop. The image should look like it belongs in a premium publication. ${bgInstruction}`;
          break;
        case "dark-moody":
          prompt = `Create an ultra-realistic 4K dark and moody photograph of ${dish}. Deep shadows, rich blacks, dramatic chiaroscuro lighting. The subject should emerge from darkness with selective highlights on key textures. Painterly Renaissance still-life feel. ${bgInstruction}`;
          break;
        case "bright-airy":
          prompt = `Create an ultra-realistic 4K bright and airy photograph of ${dish}. High-key lighting with soft, diffused natural light. The scene should feel fresh, clean, and luminous. Cheerful, modern aesthetic. ${bgInstruction}`;
          break;
        case "action":
          prompt = `Create an ultra-realistic 4K action photograph of ${dish} capturing dynamic motion — sauce being drizzled, cheese being pulled, ingredients being tossed, steam rising, or liquid being poured. Freeze the motion with sharp detail while conveying energy and appetite appeal. ${bgInstruction}`;
          break;
        case "rustic":
          prompt = `Create an ultra-realistic 4K rustic photograph of ${dish} with a farmhouse aesthetic. Weathered wood, cast iron, or natural stone surfaces. Include props like linen napkins, fresh herbs, and vintage utensils. Warm, earthy tones with natural imperfections. ${bgInstruction}`;
          break;
        case "minimalist":
          prompt = `Create an ultra-realistic 4K minimalist photograph of ${dish}. Generous negative space and minimal props. The subject should be the sole focus with nothing distracting. Modern, refined, less-is-more composition. ${bgInstruction}`;
          break;
        case "street-food":
          prompt = `Create an ultra-realistic 4K street food photograph of ${dish}. Casual, handheld, or outdoor market setting. Capture the energy of street vendors, paper wrappers, takeout containers. Raw, authentic, and appetizing with an urban feel. ${bgInstruction}`;
          break;
        case "fine-dining":
          prompt = `Create an ultra-realistic 4K fine dining photograph of ${dish}. Elegant plating on premium tableware in an upscale restaurant setting. Include fine details like microgreens, sauce dots, edible flowers, and polished surfaces. Sophisticated, luxurious, Michelin-star presentation. ${bgInstruction}`;
          break;
        case "ingredients":
          prompt = `Create an ultra-realistic 4K ingredients photograph showing the raw components of ${dish} beautifully arranged. Display fresh produce, proteins, spices, and garnishes laid out in an organized, deconstructed composition. Each ingredient should be vibrant, fresh, and clearly identifiable. ${bgInstruction}`;
          break;
        case "process":
          prompt = `Create an ultra-realistic 4K process photograph showing ${dish} being prepared. Chef's hands actively cooking, plating, or assembling in a real kitchen environment. Capture the craft and technique with flour-dusted surfaces, sizzling pans, or careful plating in progress. ${bgInstruction}`;
          break;
        case "portrait":
          prompt = `Create an ultra-realistic 4K portrait-style photograph of ${dish}, treating it as the hero subject. Shallow depth of field with creamy bokeh. The subject should have presence and personality, lit like a portrait with catchlights and dimension. ${bgInstruction}`;
          break;
        case "steam-sizzle":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} that's visibly hot, fresh, and just-cooked. Capture rising steam, sizzling oil, or heat shimmer. The viewer should feel the warmth radiating from the dish. Dynamic energy of freshly prepared food. ${bgInstruction}`;
          break;
        case "messy":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} with a messy, lived-in, authentic look. Show bites taken, sauce drips, crumbs scattered, a fork mid-use. The food should look like someone is actively enjoying it — imperfect and real, not styled. ${bgInstruction}`;
          break;
        case "table-spread":
          prompt = `Create an ultra-realistic 4K photograph of a full table spread featuring ${dish} as the centerpiece alongside complementary dishes, drinks, sides, and condiments. Show an abundant, communal dining scene from above or at an angle. ${bgInstruction}`;
          break;
        case "smoke-fire":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} with visible smoke, grill marks, open flames, or BBQ fire. The food should look freshly pulled from a grill or smoker with charred edges and wisps of smoke curling upward. Intense, primal, appetite-driving. ${bgInstruction}`;
          break;
        case "drizzle-pour":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} with an active drizzle or pour — honey, sauce, chocolate, olive oil, or glaze being poured over the food, frozen in mid-air with perfect detail. The liquid should have beautiful viscosity and light catching through it. ${bgInstruction}`;
          break;
        case "stack-tower":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} emphasizing dramatic vertical height — stacked layers, towering portions, or multiple elements piled impressively. The composition should draw the eye upward and convey abundance and indulgence. ${bgInstruction}`;
          break;
        case "bokeh":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} with an ultra-shallow depth of field and beautiful creamy bokeh in the background. Dreamy, soft, out-of-focus lights and textures behind the tack-sharp subject. Romantic and atmospheric. ${bgInstruction}`;
          break;
        case "noir":
          prompt = `Create an ultra-realistic 4K black and white photograph of ${dish}. High contrast, dramatic lighting, film noir aesthetic. Strong highlights and deep blacks with rich tonal range. Artistic and timeless. ${bgInstruction}`;
          break;
        case "neon-night":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} bathed in neon lighting — vibrant pinks, blues, and purples from neon signs in a late-night dining or bar setting. The food should glow with colorful reflections. Urban nightlife energy. ${bgInstruction}`;
          break;
        case "deconstructed":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} deconstructed — each element artistically separated and arranged to show all the individual components that make up the dish. Organized chaos, revealing the anatomy of the food. ${bgInstruction}`;
          break;
        case "comfort-cozy":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} in a cozy, warm, comfort-food setting. Soft warm lighting, knit textures, wooden surfaces, and a homey atmosphere. The image should evoke feelings of warmth, nostalgia, and home-cooked love. ${bgInstruction}`;
          break;
        case "frozen-ice":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} with frozen, icy, or cold textures — frost crystals, ice cream dripping, frozen condensation, or chilled surfaces. Capture the cold and refreshing quality with crisp detail. ${bgInstruction}`;
          break;
        case "charcuterie":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} styled as a charcuterie or grazing board spread. Show an abundant, artful arrangement of items on a board or platter with various textures, colors, and complementary elements. ${bgInstruction}`;
          break;

        case "hero":
          prompt = `Create an ultra-realistic 4K hero shot of ${dish} as a single product, dramatically staged. The product should command attention with powerful lighting, perfect angle, and a sense of importance and desirability. ${bgInstruction}`;
          break;
        case "group":
          prompt = `Create an ultra-realistic 4K group shot showing ${dish} alongside complementary or related products. Arranged artfully to show a collection or product line. Cohesive composition that highlights each item while working as a set. ${bgInstruction}`;
          break;
        case "scale":
          prompt = `Create an ultra-realistic 4K scale shot of ${dish} with context objects that show its size and proportion — a hand, common objects, or other items nearby for reference. The viewer should immediately understand the product's dimensions. ${bgInstruction}`;
          break;
        case "detail-texture":
          prompt = `Create an ultra-realistic 4K extreme close-up of ${dish} focusing on material, texture, and finish quality. Show surface detail — stitching, grain, weave, brushed metal, matte finish, or glossy surfaces. The craftsmanship should be the star. ${bgInstruction}`;
          break;
        case "packaging":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} in or with its packaging — box, label, wrapper, or bag visible. Show the unboxing experience or the product alongside its branded packaging. Clean and appealing. ${bgInstruction}`;
          break;
        case "in-use":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} being actively used by a person in a natural setting. Show the product in action — worn, held, operated, or interacted with. Authentic and relatable. ${bgInstruction}`;
          break;
        case "studio":
          prompt = `Create an ultra-realistic 4K studio catalog photograph of ${dish}. Clean, professional, e-commerce style with even lighting and minimal distractions. The product should look crisp and true-to-life, ready for an online store listing. ${bgInstruction}`;
          break;
        case "exploded":
          prompt = `Create an ultra-realistic 4K exploded view of ${dish} showing its individual components separated and floating in space, arranged to reveal internal structure and assembly. Technical yet visually striking. ${bgInstruction}`;
          break;
        case "floating":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} levitating or floating in zero gravity. Dynamic, weightless, with dramatic shadows beneath. The product should appear suspended in mid-air with a sense of energy and motion. ${bgInstruction}`;
          break;
        case "splash-action":
          prompt = `Create an ultra-realistic 4K action photograph of ${dish} with dynamic liquid splashes, water droplets, paint, or powder explosions around it. Freeze the motion at the peak of impact. High-energy and eye-catching. ${bgInstruction}`;
          break;
        case "neon-glow":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} lit by vibrant neon lights — cyberpunk aesthetic with glowing edges, colorful reflections, and a futuristic atmosphere. The product should look cutting-edge and premium. ${bgInstruction}`;
          break;
        case "luxury":
          prompt = `Create an ultra-realistic 4K luxury photograph of ${dish} styled with premium materials — velvet, marble, gold accents, silk, or dark leather surfaces. The composition should exude exclusivity, sophistication, and high-end appeal. ${bgInstruction}`;
          break;
        case "reflection":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} on a polished reflective surface — mirror, glass, or glossy table — showing a clean reflection beneath. Elegant and premium with depth and symmetry. ${bgInstruction}`;
          break;
        case "silhouette":
          prompt = `Create an ultra-realistic 4K silhouette photograph of ${dish} backlit with dramatic rim lighting. The product's outline and shape should be clearly defined against a bright or gradient background. Mysterious and artistic. ${bgInstruction}`;
          break;
        case "color-pop":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} where the product's color dramatically pops against a contrasting background. Bold color contrast that makes the product impossible to ignore. Vibrant and attention-grabbing. ${bgInstruction}`;
          break;
        case "shadow-play":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} with creative shadow compositions — window blinds, plant leaves, geometric patterns casting interesting shadows across and around the product. Artistic and atmospheric. ${bgInstruction}`;
          break;
        case "outdoor-nature":
          prompt = `Create an ultra-realistic 4K photograph of ${dish} in a natural outdoor setting — rocks, leaves, water, sand, wood, or greenery. The product should complement and contrast with the natural environment. Fresh and organic feel. ${bgInstruction}`;
          break;

        default:
          prompt = `Create a full in-frame ultra-realistic 4K photo of ${dish}. ${bgInstruction}`;
          break;
      }
    }

    // Append style options (work for both enhance and generation paths)
    const extras: string[] = [];
    if (angle) extras.push(isEnhanceMode ? `Reshoot from this perspective: ${angle}` : angle);
    if (camera) extras.push(isEnhanceMode ? `Apply the color science, rendering, and look of: ${camera}` : camera);
    if (lighting) extras.push(isEnhanceMode ? `Relight the scene with: ${lighting}` : lighting);
    if (details) extras.push(details);
    if (composition && !isEnhanceMode) extras.push(composition);
    if (extras.length) prompt += "\n\nADDITIONAL STYLE ADJUSTMENTS: " + extras.join(". ") + ".";

    // Build parts (reference image + text prompt)
    const parts: any[] = [];
    if (referenceImage) {
      parts.push({
        inlineData: {
          data: referenceImage.base64,
          mimeType: referenceImage.mimeType,
        },
      });
    }
    parts.push({ text: prompt });

    const config: any = {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: aspectRatio as AspectRatio,
        imageSize: selectedRes,
      },
    };

    // Thinking mode (Flash model only)
    if (selectedModel === "gemini-3.1-flash-image-preview" && thinkingLevel) {
      config.thinkingConfig = {
        thinkingLevel: thinkingLevel,
        includeThoughts: false,
      };
    }

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: [{ role: "user", parts }],
      config,
    });

    const responseParts = response.candidates?.[0]?.content?.parts ?? [];
    const images: { base64: string; mimeType: string }[] = [];

    for (const part of responseParts) {
      if ((part as any).inlineData) {
        images.push({
          base64: (part as any).inlineData.data,
          mimeType: (part as any).inlineData.mimeType || "image/png",
        });
      }
    }

    if (images.length === 0) {
      return res.status(422).json({ error: "No image generated. Try a different description." });
    }

    res.json({ images, promptUsed: prompt });
  } catch (err: any) {
    console.error("Asset generation error:", err?.message || err);
    let userMessage = "Failed to generate asset.";
    let statusCode = 500;
    if (err?.status && typeof err.status === "number") statusCode = err.status;
    if (err?.message) {
      try { userMessage = JSON.parse(err.message)?.error?.message || err.message; } catch { userMessage = err.message; }
    }
    res.status(statusCode).json({ error: userMessage });
  }
});

// ─── Title / Text Generation ─────────────────────────────

router.post("/generate-title", async (req, res) => {
  try {
    const {
      titleText = "",
      model = "gemini-3-pro-image-preview",
      resolution = "1K",
      thinkingLevel = "",
      textStyle = "",
      extraInstructions = "",
      backgroundColor = "#00B140",
      aspectRatio = "16:9",
      referenceImage,
    } = req.body as {
      titleText?: string;
      model?: string;
      resolution?: string;
      thinkingLevel?: string;
      textStyle?: string;
      extraInstructions?: string;
      backgroundColor?: string;
      aspectRatio?: AspectRatio;
      referenceImage?: { base64: string; mimeType: string };
    };

    const allowedModels = ["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"];
    const selectedModel = allowedModels.includes(model) ? model : "gemini-3-pro-image-preview";
    const allowedRes = ["512", "1K", "2K", "4K"];
    const selectedRes = allowedRes.includes(resolution) ? resolution : "1K";

    if (!titleText?.trim()) {
      return res.status(400).json({ error: "Title text is required." });
    }

    if (!VALID_RATIOS.includes(aspectRatio as AspectRatio)) {
      return res.status(400).json({ error: "Invalid aspect ratio." });
    }

    // Build prompt
    const promptParts: string[] = [];
    const text = titleText.trim();

    if (referenceImage) {
      promptParts.push(`Change the text in this image to say "${text}", against a solid ${backgroundColor} background.`);
      if (textStyle) promptParts.push(`Apply this text style: ${textStyle}.`);
    } else {
      promptParts.push(`Generate an image of text that says "${text}", against a solid ${backgroundColor} background.`);
      if (textStyle) {
        promptParts.push(`Style: ${textStyle}.`);
      } else {
        promptParts.push("Make it a bold, visually striking title.");
      }
    }

    promptParts.push(`The background must be flat, uniform ${backgroundColor} — no gradients, shadows, or textures.`);
    if (extraInstructions.trim()) promptParts.push(extraInstructions.trim());
    promptParts.push(`The text must spell exactly "${text}" letter by letter. Do not change any letters.`);

    const prompt = promptParts.join(" ");

    // Build request parts
    const requestParts: any[] = [];
    if (referenceImage) {
      requestParts.push({
        inlineData: {
          data: referenceImage.base64,
          mimeType: referenceImage.mimeType,
        },
      });
    }
    requestParts.push({ text: prompt });

    const config: any = {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: aspectRatio as AspectRatio,
        imageSize: selectedRes,
      },
    };

    if (selectedModel === "gemini-3.1-flash-image-preview" && thinkingLevel) {
      config.thinkingConfig = {
        thinkingLevel: thinkingLevel,
        includeThoughts: false,
      };
    }

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: [{ role: "user", parts: requestParts }],
      config,
    });

    const respParts = response.candidates?.[0]?.content?.parts ?? [];
    const images: { base64: string; mimeType: string }[] = [];

    for (const part of respParts) {
      if ((part as any).inlineData) {
        images.push({
          base64: (part as any).inlineData.data,
          mimeType: (part as any).inlineData.mimeType || "image/png",
        });
      }
    }

    if (images.length === 0) {
      return res.status(422).json({ error: "No image generated. Try different text or style." });
    }

    res.json({ images, promptUsed: prompt });
  } catch (err: any) {
    console.error("Title generation error:", err?.message || err);
    let userMessage = "Failed to generate title.";
    let statusCode = 500;
    if (err?.status && typeof err.status === "number") statusCode = err.status;
    if (err?.message) {
      try { userMessage = JSON.parse(err.message)?.error?.message || err.message; } catch { userMessage = err.message; }
    }
    res.status(statusCode).json({ error: userMessage });
  }
});

/** Browser fetch often fails on Firebase Storage URLs (CORS / cookies). Server fetch for caption pipeline only. */
router.post("/fetch-image-base64", async (req, res) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ error: "url is required." });
    }
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      return res.status(400).json({ error: "Invalid URL." });
    }
    if (parsed.protocol !== "https:") {
      return res.status(400).json({ error: "Only https URLs are allowed." });
    }
    const host = parsed.hostname.toLowerCase();
    const allowedHost =
      host.endsWith("firebasestorage.googleapis.com") ||
      host.endsWith("firebasestorage.app") ||
      host.endsWith("googleapis.com") ||
      host.endsWith("storage.googleapis.com") ||
      host.endsWith("firebaseapp.com") ||
      host.endsWith("appspot.com") ||
      host.endsWith("cloudinary.com") ||
      host.endsWith("imgur.com");
    if (!allowedHost) {
      return res.status(403).json({ error: "Image host is not allowed for proxy fetch." });
    }
    const imgRes = await fetch(url.trim(), { redirect: "follow" });
    if (!imgRes.ok) {
      return res.status(502).json({ error: `Image fetch failed (${imgRes.status}).` });
    }
    const mimeRaw = imgRes.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    if (!mimeRaw.startsWith("image/")) {
      return res.status(400).json({ error: "URL did not return an image." });
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length > 18 * 1024 * 1024) {
      return res.status(400).json({ error: "Image is too large." });
    }
    res.json({ base64: buf.toString("base64"), mimeType: mimeRaw });
  } catch (e) {
    console.error("fetch-image-base64:", e);
    res.status(500).json({ error: "Could not load image." });
  }
});

// ─── Caption Generation ──────────────────────────────────

const PLATFORM_LIMITS: Record<string, number> = {
  instagram: 2200,
  twitter: 280,
  linkedin: 3000,
  tiktok: 2200,
  facebook: 63206,
};

router.post("/generate-caption", async (req, res) => {
  try {
    const {
      brandContext,
      accountId,
      media = [],
      platform = "instagram",
      captionStyle = "short-sweet",
      topic,
      includeHashtags = true,
      includeEmojis = false,
    } = req.body as {
      brandContext?: {
        company: string;
        industry?: string | null;
        description?: string | null;
        brandVoice?: string | null;
        targetAudience?: string | null;
        socialHandles?: Record<string, string> | null;
      };
      accountId?: number;
      media?: { base64: string; mimeType: string }[];
      platform?: string;
      captionStyle?: string;
      topic?: string;
      includeHashtags?: boolean;
      includeEmojis?: boolean;
    };

    if (!topic?.trim() && media.length === 0) {
      return res.status(400).json({ error: "Provide media or a topic." });
    }

    let brand: {
      company: string;
      industry: string | null;
      description: string | null;
      brandVoice: string | null;
      targetAudience: string | null;
      socialHandles: Record<string, string> | null;
    };

    if (brandContext) {
      brand = {
        company: brandContext.company,
        industry: brandContext.industry || null,
        description: brandContext.description || null,
        brandVoice: brandContext.brandVoice || null,
        targetAudience: brandContext.targetAudience || null,
        socialHandles: brandContext.socialHandles || null,
      };
    } else if (accountId) {
      const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
      if (!account) {
        return res.status(404).json({ error: "Account not found." });
      }
      brand = {
        company: account.company,
        industry: account.industry,
        description: account.description,
        brandVoice: account.brandVoice,
        targetAudience: account.targetAudience,
        socialHandles: account.socialHandles as Record<string, string> | null,
      };
    } else {
      return res.status(400).json({ error: "Either brandContext or accountId is required." });
    }

    const charLimit = PLATFORM_LIMITS[platform] || 2200;
    const handle = brand.socialHandles?.[platform] || "";

    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);

    // Caption style instructions
    const styleMap: Record<string, string> = {
      "short-sweet": "SHORT & SWEET — 1-2 punchy sentences max. Get in, make an impact, get out. Every word must earn its place.",
      "long-form": "LONG FORM — Write paragraph-style storytelling captions. Paint a vivid picture, tell a story, take the reader on a journey. 4-6 sentences minimum.",
      "engaging": "ENGAGING — Every caption must drive interaction. Use questions, 'tag a friend who…', polls, 'agree or disagree?', fill-in-the-blank, or 'comment your…'. Optimize for comments and shares.",
      "witty": "WITTY — Clever wordplay, puns, double meanings, and humor. Make people smile or laugh. Smart, not corny. Think dad jokes meets copywriter.",
      "bold": "BOLD & DIRECT — Strong declarative statements, hot takes, and confident claims. No hedging, no 'maybe'. Unapologetic and attention-grabbing.",
      "storytelling": "STORYTELLING — Each caption is a mini-narrative. Set the scene, build tension or curiosity, deliver a satisfying ending. Make the reader feel like they were there.",
      "hype": "HYPE — Pure excitement and energy. Build anticipation, use exclamation marks strategically, create FOMO. The reader should feel the buzz.",
      "chill": "CHILL & CASUAL — Write like you're texting a friend. Laid-back, effortless, no corporate speak. Lowercase energy, unbothered vibes.",
      "emotional": "EMOTIONAL — Tap into deep feelings. Nostalgia, gratitude, love, pride, comfort. Make people FEEL something. Heartfelt and genuine, not manipulative.",
      "educational": "EDUCATIONAL — Lead with an interesting fact, tip, or 'did you know?'. Teach the audience something they didn't know. Informative but not boring.",
      "trendy": "TRENDY — Use current slang, viral formats, meme energy, and cultural references. Write like Gen Z social media managers who are terminally online (in a good way).",
      "professional": "PROFESSIONAL — Polished, brand-forward, and clean. Appropriate for corporate social, LinkedIn crossposting, or upscale brands. Refined but not stiff.",
      "promo": "PROMO / SALE — Urgency-driven. Limited time offers, special deals, exclusive announcements. Clear value proposition with a strong call to action. Make them ACT NOW.",
      "seasonal": "SEASONAL — Tie everything to the current season, holiday, weather, or time of year. Make the content feel timely and relevant to what's happening right now.",
      "fomo": "FOMO — Create fear of missing out. Scarcity, exclusivity, 'selling fast', 'last chance', 'only X left'. The reader should feel they NEED to act immediately.",
      "question": "QUESTION HOOK — Every caption must OPEN with a compelling question that makes people stop and think. Then deliver the answer or tease it. Curiosity-driven.",
      "listicle": "LISTICLE — Use numbered lists, top 3/5 formats, or 'reasons why' structures. Organized, scannable, and satisfying. People love lists.",
      "testimonial": "TESTIMONIAL — Write as if a customer is speaking. Social proof, reviews-style, 'our customers say…'. Authentic voices that build trust.",
      "nostalgic": "NOSTALGIC — Throwback energy. 'Remember when…', childhood memories, comfort food moments, 'the one that started it all'. Warm and sentimental.",
      "inspirational": "INSPIRATIONAL — Motivational and uplifting. Connect the brand to bigger themes — dreams, hard work, community, passion. Aspirational without being preachy.",
      "behind-scenes": "BEHIND THE SCENES — Insider access. Show the process, the people, the craft. 'Here's what goes into…', 'What you don't see is…'. Authenticity and transparency.",
      "controversial": "HOT TAKE — Unpopular opinions, debate starters, 'we said what we said'. Polarizing (in a fun way) to drive comments and engagement. Bold and unapologetic.",
      "minimal": "MINIMAL — Ultra-short. 5 words or fewer per caption. Let the image do the talking. Mic-drop energy. Sometimes less is everything.",
      "poetic": "POETIC — Lyrical, rhythmic, artistic flow. Short lines, intentional spacing, metaphors. The caption should read like poetry or song lyrics.",
    };

    const styleInstruction = styleMap[captionStyle] || styleMap["short-sweet"];

    const textPrompt = `You're the social media voice of ${brand.company}. You write like a real person — warm, fun, and relatable. Your captions make people stop scrolling, smile, and engage.

BRAND:
- Company: ${brand.company}
- Industry: ${brand.industry || "N/A"}
- About: ${brand.description || "N/A"}
- Voice: ${brand.brandVoice || "Fun, warm, and conversational"}
- Audience: ${brand.targetAudience || "General audience"}
- Handle: ${handle || "N/A"}

CAPTION STYLE:
${styleInstruction}

YOUR JOB:
${media.length > 0 ? `1. Look at the attached media — what's in it? Be specific (name the dish, the vibe, the moment).
2. Connect what you see to ${brand.company}'s personality. If it's a lasagna, don't say "delicious pasta" — say "layers of heaven that'll make your nonna jealous."
3. Write 5 captions for ${platformName} in the style described above.` : `Write 5 captions for ${platformName} that capture ${brand.company}'s personality, using the style described above.`}
${topic?.trim() ? `\nEXTRA CONTEXT: ${topic}` : ""}

RULES:
- ALL 5 captions must follow the CAPTION STYLE above — this is the #1 priority
- Sound like you're talking TO the customer, not AT them
- Be SPECIFIC — "our hand-rolled gnocchi in sage brown butter" not "delicious food"
- Make people want to tag a friend, comment, or visit
- EVERY caption MUST end with a natural call-to-action (CTA) that drives the reader back to the brand's main goal — visiting the location, ordering online, booking a table, checking out the menu, clicking the link in bio, etc. The CTA should feel organic, not salesy.
- Max ${charLimit} characters each
- ${includeHashtags ? "End with 3-5 specific hashtags AFTER the CTA (brand name + niche tags, NOT generic ones like #food #love)" : "No hashtags"}
- ${includeEmojis ? "Use emojis naturally — like a real person would text" : "No emojis"}

Write 5 variations — each one different but ALL in the "${captionStyle}" style.

FORMAT: Return ONLY a JSON array of exactly 5 strings. No markdown, no explanation.
Example: ["Caption 1...", "Caption 2...", "Caption 3...", "Caption 4...", "Caption 5..."]`;

    const parts: any[] = [];

    for (const m of media) {
      parts.push({
        inlineData: {
          data: m.base64,
          mimeType: m.mimeType,
        },
      });
    }

    parts.push({ text: textPrompt });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts }],
    });

    const text = response.text ?? "";
    let captions: string[] = [];

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try { captions = JSON.parse(jsonMatch[0]); } catch {}
    }

    if (!captions.length) {
      captions = text.split(/\n{2,}/).filter((s) => s.trim().length > 10).slice(0, 5);
    }

    if (!captions.length) {
      return res.status(422).json({ error: "Failed to generate captions. Try again." });
    }

    res.json({ captions, platform, charLimit });
  } catch (err: any) {
    console.error("Caption generation error:", err?.message || err);

    // The @google/genai SDK wraps API errors with a JSON string as .message
    // e.g. '{"error":{"code":500,"message":"...","status":"INTERNAL"}}'
    let userMessage = "Failed to generate captions.";
    let statusCode = 500;

    if (err?.status && typeof err.status === "number") {
      statusCode = err.status;
    }

    if (err?.message) {
      try {
        const parsed = JSON.parse(err.message);
        userMessage = parsed?.error?.message || err.message;
      } catch {
        userMessage = err.message;
      }
    }

    res.status(statusCode).json({ error: userMessage });
  }
});

// ─── Quote Suggestions from Photo ─────────────────────────

router.post("/generate-quote", async (req, res) => {
  try {
    const { image, brandContext } = req.body as {
      image?: { base64: string; mimeType: string };
      brandContext?: {
        company: string;
        industry?: string | null;
        brandVoice?: string | null;
        targetAudience?: string | null;
      };
    };

    if (!image?.base64) {
      return res.status(400).json({ error: "An image is required." });
    }

    const brandBlock = brandContext
      ? `\n\nBRAND CONTEXT — tailor quotes to this brand's identity:
- Company: ${brandContext.company}
- Industry: ${brandContext.industry || "N/A"}
- Voice: ${brandContext.brandVoice || "N/A"}
- Audience: ${brandContext.targetAudience || "General"}\n
Some quotes should directly relate to the brand's industry and speak to their audience. Mix brand-relevant quotes with universal ones.`
      : "";

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: image.base64,
                mimeType: image.mimeType,
              },
            },
            {
              text: `Look at this photo carefully. Analyze its mood, subject, colors, setting, and emotional tone.${brandBlock}

Generate 8 quotes that would pair beautifully as text overlays on this image for a social media post. Mix these types:
1. 2 original/inspirational quotes that match the photo's vibe
2. 2 famous quotes from well-known authors, philosophers, or public figures that relate to what's in the photo
3. 2 motivational or empowering quotes that connect to the photo's theme
4. 2 short, punchy captions or one-liners (under 15 words) perfect for Instagram/TikTok

Each quote should feel like it BELONGS with this specific image — not generic.

Return ONLY a JSON array of objects with "text" and optional "attribution" fields.
Example: [{"text": "The best things in life are the people you love", "attribution": "Unknown"}, {"text": "Sunsets are proof that endings can be beautiful too"}]

No markdown, no explanation — just the JSON array.`,
            },
          ],
        },
      ],
    });

    const text = response.text ?? "";
    let quotes: { text: string; attribution?: string }[] = [];

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        quotes = JSON.parse(jsonMatch[0]);
      } catch {}
    }

    if (!quotes.length) {
      return res.status(422).json({ error: "Failed to generate quotes. Try again." });
    }

    res.json({ quotes });
  } catch (err: any) {
    console.error("Quote generation error:", err?.message || err);
    let userMessage = "Failed to generate quotes.";
    let statusCode = 500;

    if (err?.status && typeof err.status === "number") {
      statusCode = err.status;
    }

    if (err?.message) {
      try {
        const parsed = JSON.parse(err.message);
        userMessage = parsed?.error?.message || err.message;
      } catch {
        userMessage = err.message;
      }
    }

    res.status(statusCode).json({ error: userMessage });
  }
});

// ─── Google Places: Search & Reviews ─────────────────────

router.post("/search-places", async (req, res) => {
  try {
    const { query: searchQuery } = req.body as { query?: string };
    if (!searchQuery?.trim()) {
      return res.status(400).json({ error: "A search query is required." });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: "No Google API key configured." });
    }

    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchQuery.trim())}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("Places search error:", data.status, data.error_message);
      return res.status(400).json({
        error: data.error_message || `Places API error: ${data.status}. Enable the Places API on your Google Cloud project.`,
      });
    }

    const places = (data.results || []).slice(0, 10).map((p: any) => {
      let photoUrl: string | null = null;
      if (p.photos?.[0]?.photo_reference) {
        photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photo_reference=${p.photos[0].photo_reference}&key=${apiKey}`;
      }
      return {
        id: p.place_id,
        name: p.name || "",
        address: p.formatted_address || "",
        rating: p.rating,
        reviewCount: p.user_ratings_total,
        photoUrl,
      };
    });

    res.json({ places });
  } catch (err: any) {
    console.error("Places search error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to search places." });
  }
});

router.post("/place-reviews", async (req, res) => {
  try {
    const { placeId, nextPageToken, sort } = req.body as {
      placeId?: string;
      nextPageToken?: string;
      sort?: string;
    };
    if (!placeId?.trim()) {
      return res.status(400).json({ error: "A place ID is required." });
    }

    // Use SerpAPI if key is available (returns reviewer photos + pagination)
    const serpKey = process.env.SERPAPI_KEY;
    if (serpKey) {
      let url: string;
      if (nextPageToken) {
        // Use the token-based pagination URL from SerpAPI
        url = `https://serpapi.com/search.json?engine=google_maps_reviews&place_id=${encodeURIComponent(placeId)}&next_page_token=${encodeURIComponent(nextPageToken)}&api_key=${serpKey}`;
      } else {
        url = `https://serpapi.com/search.json?engine=google_maps_reviews&place_id=${encodeURIComponent(placeId)}&api_key=${serpKey}`;
      }
      if (sort) url += `&sort_by=${encodeURIComponent(sort)}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        console.error("SerpAPI error:", data.error);
        // Fall through to Google Places API below
      } else {
        const reviews = (data.reviews || []).map((r: any) => ({
          authorName: r.user?.name || "Anonymous",
          authorPhoto: r.user?.thumbnail || null,
          rating: r.rating || 5,
          text: r.snippet || r.text || "",
          relativeTime: r.date || "",
          photos: (r.images || []).map((img: string) =>
            img.replace(/=w\d+-h\d+/, "=w800-h800")
          ),
        }));

        const serpNextToken = data.serpapi_pagination?.next_page_token || null;

        return res.json({
          placeName: data.place_info?.title || "",
          rating: data.place_info?.rating,
          reviewCount: data.place_info?.reviews || 0,
          reviews,
          hasMore: !!serpNextToken,
          nextPageToken: serpNextToken,
        });
      }
    }

    // Fallback: Google Places API (no reviewer photos, max 5 reviews, no pagination)
    const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: "No API key configured." });
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,rating,user_ratings_total,reviews&reviews_sort=newest&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK") {
      console.error("Place details error:", data.status, data.error_message);
      return res.status(400).json({
        error: data.error_message || `Places API error: ${data.status}`,
      });
    }

    const result = data.result || {};
    const reviews = (result.reviews || []).map((r: any) => ({
      authorName: r.author_name || "Anonymous",
      authorPhoto: r.profile_photo_url || null,
      rating: r.rating || 5,
      text: r.text || "",
      relativeTime: r.relative_time_description || "",
      photos: [],
    }));

    res.json({
      placeName: result.name || "",
      rating: result.rating,
      reviewCount: result.user_ratings_total,
      reviews,
      hasMore: false,
    });
  } catch (err: any) {
    console.error("Place reviews error:", err?.message || err);
    res
      .status(500)
      .json({ error: err?.message || "Failed to fetch reviews." });
  }
});

// ─── Remix: Analyze Graphic ──────────────────────────────

router.post("/analyze-graphic", async (req, res) => {
  try {
    const { imageBase64, imageMimeType } = req.body as {
      imageBase64: string;
      imageMimeType: string;
    };

    if (!imageBase64) {
      return res.status(400).json({ error: "An image is required." });
    }

    const prompt = `Analyze this graphic design in extreme detail. Return a JSON object with:

1. "layout": {
  "type": one of "poster", "social-post", "flyer", "menu-item", "ad", "banner", "story", "promo", "other",
  "orientation": "portrait" or "landscape" or "square",
  "gridDescription": a detailed sentence describing how the graphic is laid out spatially, e.g. "Left 40% has a large food photo, right 60% has text on a solid dark green background with the logo in the top-right corner"
}

2. "elements": an array where each item is {
  "type": one of "logo", "text-heading", "text-subheading", "text-body", "food-photo", "product-photo", "decorative", "background", "shape", "icon", "price-tag", "badge", "pattern",
  "position": one of "top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right", "full-bleed", "left-half", "right-half", "top-half", "bottom-half", "top-third", "middle-third", "bottom-third",
  "size": "small", "medium", "large", or "full",
  "content": what it says or depicts (be very specific),
  "style": visual description of how it looks (font style, color, effects, crop style, etc.)
}

3. "colorScheme": {
  "primary": hex color,
  "secondary": hex color,
  "accent": hex color or null,
  "background": hex color or description,
  "textColor": hex color
}

4. "typography": {
  "headingStyle": description like "Bold uppercase sans-serif, white, large, with drop shadow",
  "bodyStyle": description like "Regular weight, small, light gray sans-serif",
  "decorativeStyle": description or null
}

5. "mood": a short description of the overall feel, e.g. "Bold promotional restaurant ad with warm tones"

6. "backgroundStyle": detailed description, e.g. "Solid dark green #1B5E20 with subtle diagonal stripe pattern"

Return ONLY the JSON object, no markdown, no explanation.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{
        role: "user",
        parts: [
          { inlineData: { data: imageBase64, mimeType: imageMimeType } },
          { text: prompt },
        ],
      }],
    });

    const text = response.text ?? "";
    let analysis: any = {
      layout: { type: "other", orientation: "square", gridDescription: "" },
      elements: [],
      colorScheme: { primary: "#000", secondary: "#333", accent: null, background: "#fff", textColor: "#000" },
      typography: { headingStyle: "", bodyStyle: "", decorativeStyle: null },
      mood: "",
      backgroundStyle: "",
    };

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { analysis = { ...analysis, ...JSON.parse(jsonMatch[0]) }; } catch {}
    }

    res.json(analysis);
  } catch (err: any) {
    console.error("Analyze graphic error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to analyze graphic." });
  }
});

// ─── Remix: Generate ─────────────────────────────────────

router.post("/remix-graphic", async (req, res) => {
  try {
    const {
      originalImage,
      analysis,
      logo,
      brandColors = [],
      brandFont,
      companyName = "",
      replacementAssets = [],
      model = "gemini-3-pro-image-preview",
      resolution = "1K",
      aspectRatio = "1:1",
      additionalInstructions = "",
      improveQuality = false,
      textOverrides = {},
    } = req.body as {
      originalImage: { base64: string; mimeType: string };
      analysis: any;
      logo?: { base64: string; mimeType: string } | null;
      brandColors?: string[];
      brandFont?: string | null;
      companyName?: string;
      replacementAssets?: { base64: string; mimeType: string; description: string }[];
      model?: string;
      resolution?: string;
      aspectRatio?: string;
      additionalInstructions?: string;
      improveQuality?: boolean;
      textOverrides?: Record<string, string>;
    };

    if (!originalImage?.base64) {
      return res.status(400).json({ error: "Original graphic is required." });
    }

    const allowedModels = ["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"];
    const selectedModel = allowedModels.includes(model) ? model : "gemini-3-pro-image-preview";

    // Count images for reference numbering
    const imageCount = 1 + (logo ? 1 : 0) + replacementAssets.length;
    const imageLabels: string[] = ["Image 1: The original reference graphic — recreate this exact layout"];
    let imgNum = 2;
    if (logo) { imageLabels.push(`Image ${imgNum}: The brand logo to place where the original logo is`); imgNum++; }
    replacementAssets.forEach((a, i) => {
      imageLabels.push(`Image ${imgNum}: Replacement asset — "${a.description}"`);
      imgNum++;
    });

    // Build element-by-element instructions from analysis
    const elementInstructions: string[] = [];
    let assetIdx = 0;
    for (let i = 0; i < (analysis.elements || []).length; i++) {
      const el = analysis.elements[i];
      if (el.type === "logo") {
        elementInstructions.push(
          `- LOGO at ${el.position} (${el.size}): ${logo ? "Replace with the provided brand logo (Image 2). Match the same position, relative size, and visual treatment." : "Keep a logo placeholder in the same position."}`
        );
      } else if (el.type === "food-photo" || el.type === "product-photo") {
        if (assetIdx < replacementAssets.length) {
          const refImg = (logo ? 3 : 2) + assetIdx;
          elementInstructions.push(
            `- ${el.type.toUpperCase()} at ${el.position} (${el.size}): Original showed "${el.content}". Replace with Image ${refImg} ("${replacementAssets[assetIdx].description}"). Match the same crop, framing, and position.`
          );
          assetIdx++;
        } else {
          elementInstructions.push(
            `- ${el.type.toUpperCase()} at ${el.position} (${el.size}): Original showed "${el.content}". Keep a similar image but adapt colors to the new brand.`
          );
        }
      } else if (el.type.startsWith("text")) {
        const overrideText = textOverrides[String(i)];
        const finalText = overrideText !== undefined && overrideText !== el.content ? overrideText : el.content;
        const changed = overrideText !== undefined && overrideText !== el.content;
        elementInstructions.push(
          `- ${el.type.toUpperCase()} at ${el.position}: "${finalText}"${changed ? ' (USER CHANGED THIS TEXT — use this exact new text, NOT the original)' : ''} — styled as: ${el.style}`
        );
      } else {
        elementInstructions.push(
          `- ${el.type.toUpperCase()} at ${el.position} (${el.size}): "${el.content}" — ${el.style}`
        );
      }
    }

    // Color mapping
    const colorMap = brandColors.length > 0
      ? `Replace the original colors with these brand colors: ${brandColors.map((c, i) => `Color ${i + 1}: ${c}`).join(", ")}. Map primary→${brandColors[0]}, secondary→${brandColors[1] || brandColors[0]}, accent→${brandColors[2] || brandColors[1] || brandColors[0]}.`
      : "Keep the original color scheme.";

    // Font
    const fontInstruction = brandFont
      ? `Use "${brandFont}" font for all text, maintaining the same weight/size proportions.`
      : "Maintain similar typography to the original.";

    const prompt = `I'm providing ${imageCount} images:
${imageLabels.join("\n")}

TASK: Recreate the graphic from Image 1 with the following brand substitutions. The new graphic MUST match the original's exact layout, element placement, spacing, and composition.

LAYOUT: ${analysis.layout?.gridDescription || "Match the original layout exactly."}
Orientation: ${analysis.layout?.orientation || "match original"}

ELEMENT-BY-ELEMENT RECONSTRUCTION:
${elementInstructions.join("\n")}

COLOR SCHEME:
Original: primary=${analysis.colorScheme?.primary}, secondary=${analysis.colorScheme?.secondary}, accent=${analysis.colorScheme?.accent}
${colorMap}

TYPOGRAPHY:
${fontInstruction}
Original heading: ${analysis.typography?.headingStyle || "bold heading"}
Original body: ${analysis.typography?.bodyStyle || "regular body text"}

BACKGROUND: ${analysis.backgroundStyle || "Match the original"}. Adapt to use the new brand colors while maintaining the same style/pattern.

OVERALL MOOD: ${analysis.mood || "Match the original feel"}

${companyName ? `BRAND NAME: "${companyName}" — if the original graphic shows a company name, replace it with this.` : ""}

CRITICAL RULES:
- Match the original layout EXACTLY — same positions, proportions, spacing
- All text must be clearly legible and spelled correctly
- The result must look like a polished, professional graphic design
- Use ONLY the provided brand colors (plus white/black for text as needed)
- Do NOT add elements that weren't in the original
${improveQuality ? `\nQUALITY ENHANCEMENT: Go beyond simply copying the layout — actively improve the overall composition, visual hierarchy, balance, and professional polish. Enhance lighting consistency, color harmony, typography spacing, and element alignment. Make it look like a top-tier professional designer refined every detail. The output should be noticeably higher quality than the original while keeping the same layout and brand substitutions.` : ""}
${additionalInstructions ? `\nADDITIONAL INSTRUCTIONS: ${additionalInstructions}` : ""}`;

    // Build parts array
    const parts: any[] = [];
    parts.push({ inlineData: { data: originalImage.base64, mimeType: originalImage.mimeType } });
    if (logo) {
      parts.push({ inlineData: { data: logo.base64, mimeType: logo.mimeType } });
    }
    for (const asset of replacementAssets) {
      parts.push({ inlineData: { data: asset.base64, mimeType: asset.mimeType } });
    }
    parts.push({ text: prompt });

    const config: any = {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: aspectRatio as any,
        imageSize: resolution,
      },
    };

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: [{ role: "user", parts }],
      config,
    });

    const responseParts = response.candidates?.[0]?.content?.parts ?? [];
    const images: { base64: string; mimeType: string }[] = [];

    for (const part of responseParts) {
      if ((part as any).inlineData) {
        images.push({
          base64: (part as any).inlineData.data,
          mimeType: (part as any).inlineData.mimeType || "image/png",
        });
      }
    }

    if (images.length === 0) {
      return res.status(422).json({ error: "No image generated. Try adjusting your instructions." });
    }

    res.json({ images });
  } catch (err: any) {
    console.error("Remix error:", err?.message || err);
    let msg = "Failed to remix graphic.";
    if (err?.message) {
      try { msg = JSON.parse(err.message)?.error?.message || err.message; } catch { msg = err.message; }
    }
    res.status(err?.status || 500).json({ error: msg });
  }
});

// ─── Business Search (SerpAPI) ────────────────────────────

router.post("/search-business", async (req, res) => {
  try {
    const { query: searchQuery } = req.body as { query?: string };
    if (!searchQuery?.trim()) {
      return res.status(400).json({ error: "A search query is required." });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: "No Google API key configured." });
    }

    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchQuery.trim())}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return res.status(400).json({ error: data.error_message || `Places API error: ${data.status}` });
    }

    const results = (data.results || []).slice(0, 8).map((r: any) => {
      let thumbnail: string | null = null;
      if (r.photos?.[0]?.photo_reference) {
        thumbnail = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${r.photos[0].photo_reference}&key=${apiKey}`;
      }
      return {
        placeId: r.place_id,
        name: r.name || "",
        type: r.types?.[0]?.replace(/_/g, " ") || "",
        address: r.formatted_address || "",
        phone: "",
        website: "",
        rating: r.rating,
        reviews: r.user_ratings_total,
        thumbnail: thumbnail || "",
        description: "",
      };
    });

    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Search failed." });
  }
});

router.post("/business-details", async (req, res) => {
  try {
    const { placeId } = req.body as { placeId?: string };
    if (!placeId?.trim()) {
      return res.status(400).json({ error: "A place ID is required." });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: "No Google API key configured." });
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,types,formatted_address,formatted_phone_number,website,rating,user_ratings_total,editorial_summary,photos,url&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK") {
      return res.status(400).json({ error: data.error_message || `Places API error: ${data.status}` });
    }

    const info = data.result || {};

    let thumbnail: string | null = null;
    const images: string[] = [];
    if (info.photos) {
      for (const photo of info.photos.slice(0, 5)) {
        const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photo.photo_reference}&key=${apiKey}`;
        images.push(photoUrl);
        if (!thumbnail) thumbnail = photoUrl;
      }
    }

    res.json({
      name: info.name || "",
      type: (info.types || []).map((t: string) => t.replace(/_/g, " ")).slice(0, 3).join(", "),
      address: info.formatted_address || "",
      phone: info.formatted_phone_number || "",
      website: info.website || "",
      rating: info.rating,
      reviewCount: info.user_ratings_total,
      description: info.editorial_summary?.overview || "",
      thumbnail: thumbnail || "",
      images,
      placeId: info.place_id || placeId,
      mapsUrl: info.url || "",
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to get business details." });
  }
});

// ─── Analyze Asset (identify dish, match menu items) ─────

router.post("/analyze-asset", async (req, res) => {
  try {
    const { imageBase64, imageMimeType, menuItems } = req.body as {
      imageBase64: string;
      imageMimeType: string;
      menuItems?: { name: string; category: string; description?: string }[];
    };

    if (!imageBase64) {
      return res.status(400).json({ error: "Image is required." });
    }

    const menuContext = menuItems?.length
      ? `\n\nMENU ITEMS TO MATCH AGAINST:\n${menuItems.map(m => `- ${m.name} (${m.category})${m.description ? ': ' + m.description : ''}`).join('\n')}`
      : '';

    const prompt = `Analyze this food/product image. Return a JSON object with:
- "name": what the dish or product is (be specific, e.g. "Chicken Parmesan with Spaghetti" not just "pasta")
- "category": the category (e.g. "Entree", "Appetizer", "Dessert", "Beverage", "Side", "Product")
- "tags": array of 3-5 descriptive tags (e.g. ["italian", "chicken", "pasta", "tomato sauce", "cheese"])
- "description": a brief 1-sentence description of what's in the image
- "menuMatch": if any of the menu items below match this image, return the exact menu item name. Otherwise null.
${menuContext}

Return ONLY the JSON object, no markdown.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{
        role: "user",
        parts: [
          { inlineData: { data: imageBase64, mimeType: imageMimeType } },
          { text: prompt },
        ],
      }],
    });

    const text = response.text ?? "";
    let analysis = { name: "Unknown", category: "Uncategorized", tags: [], description: "", menuMatch: null };

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { analysis = { ...analysis, ...JSON.parse(jsonMatch[0]) }; } catch {}
    }

    res.json(analysis);
  } catch (err: any) {
    console.error("Asset analysis error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to analyze asset." });
  }
});

// ─── Image Proxy (for CORS-safe export) ──────────────────

router.get("/image-proxy", async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: "url param required" });

    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).end();

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch {
    res.status(500).end();
  }
});

// ─── Google Fonts Search ─────────────────────────────────

// Cache the font list in memory (loaded once from Google's public metadata)
let fontCache: { family: string; category: string }[] = [];
let fontCacheTime = 0;

router.get("/fonts", async (req, res) => {
  try {
    const search = (req.query.q as string || "").toLowerCase();

    // Refresh cache every 24 hours
    if (!fontCache.length || Date.now() - fontCacheTime > 86400000) {
      // Use Google Fonts metadata endpoint (no API key needed)
      const response = await fetch(
        "https://fonts.google.com/metadata/fonts"
      );
      const text = await response.text();
      // The response starts with )]} — strip it
      const json = JSON.parse(text.replace(/^\)\]\}'?\n?/, ""));
      fontCache = (json.familyMetadataList || []).map((f: any) => ({
        family: f.family,
        category: (f.category || "").toLowerCase().replace("_", "-"),
      }));
      fontCacheTime = Date.now();
    }

    let fonts = fontCache;
    if (search) {
      fonts = fonts.filter((f) => f.family.toLowerCase().includes(search));
    }

    res.json({ fonts: fonts.slice(0, 50) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to fetch fonts." });
  }
});

export default router;
