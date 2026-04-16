import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

import { firebaseConfig } from "./firebase-config";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateAcmeMenu() {
  console.log("Replacing ACME Bar & Grill menu with full Waiter on the Way data...\n");

  const q = query(collection(db, "accounts"), where("company", "==", "ACME Bar & Grill"));
  const snap = await getDocs(q);
  if (snap.empty) { console.error("Account not found!"); process.exit(1); }

  const accountId = snap.docs[0].id;
  console.log(`  Found account → ${accountId}`);

  // Clear old menu items
  const existing = await getDocs(query(collection(db, "menu_items"), where("accountId", "==", accountId)));
  for (const d of existing.docs) await deleteDoc(d.ref);
  if (existing.size) console.log(`  Cleared ${existing.size} old menu items`);

  const menuItems = [
    // ── Appetizers (18) ──────────────────────────────────────
    { name: "Acme Sampler", description: "6 onion rings, 8 fried mushrooms, 2 mozzarella sticks, 2 fried pickles, 2 chicken strips, fries", price: "$17.25", category: "Appetizers" },
    { name: "Dip Trio", description: "Beer queso, salsa, street corn dip with chips", price: "$16.09", category: "Appetizers" },
    { name: "Loaded Fries", description: "Fries, bacon, beer queso, green onion, jalapeno, creme fraiche", price: "$10.39", category: "Appetizers" },
    { name: "Duck Wontons (5pc)", description: "Cream cheese, duck bacon, sweet corn, red pepper, green onion, basil, sweet chili sauce", price: "$17.29", category: "Appetizers" },
    { name: "Beer Queso & Chips", description: "House queso with tortilla chips", price: "$10.39", category: "Appetizers" },
    { name: "Guacamole & Chips", description: "Fresh made guacamole with chips", price: "$9.19", category: "Appetizers" },
    { name: "Street Corn Dip & Chips", description: "Smoked corn, cilantro, tomato, mayo, creme fraiche, cotija, cholula, lime, jalapeno", price: "$9.19", category: "Appetizers" },
    { name: "Onion Rings (8-10pc)", description: "Crispy golden onion rings with Acme sauce", price: "$8.09", category: "Appetizers" },
    { name: "Salsa & Chips", description: "House salsa with tortilla chips", price: "$8.09", category: "Appetizers" },
    { name: "Mozzarella Sticks (6pc)", description: "With marinara dip", price: "$10.39", category: "Appetizers" },
    { name: "Fried Pickle Spears (6pc)", description: "With Acme sauce", price: "$9.19", category: "Appetizers" },
    { name: "Fried Mushrooms (12pc)", description: "With Acme sauce", price: "$9.19", category: "Appetizers" },
    { name: "Bacon Jalapeno Mac Bites (8pc)", description: "Mac n cheese balls, fried golden, with Acme sauce", price: "$9.19", category: "Appetizers" },
    { name: "Soup", description: "Choice of size — call for availability", price: "$4.59", category: "Appetizers" },
    { name: "Dough Puffs", description: "Sourdough puffs, garlic butter, parmesan, dipping sauce", price: "$8.09", category: "Appetizers" },
    { name: "Breadsticks (4pc)", description: "Sourdough breadsticks with dipping sauce", price: "$9.19", category: "Appetizers" },
    { name: "Garlic Cheesy Bread (4pc)", description: "Sliced baguette, garlic butter, mozzarella", price: "$9.19", category: "Appetizers" },
    { name: "Acme Cheese Roll", description: "Sourdough, mozzarella, mexican cheese, garlic butter", price: "$9.79", category: "Appetizers" },

    // ── BBQ (9) ──────────────────────────────────────────────
    { name: "The Shareable Combo", description: "8 smoked wings + 1/2 rack baby back ribs", price: "$34.49", category: "Entrees" },
    { name: "Dry Rub Baby Back Ribs", description: "Choice of half/full rack, served dry rub with choice of sauce", price: "$19.59", category: "Entrees" },
    { name: "Brisket Mac", description: "Mac n cheese topped with smoked brisket and house BBQ", price: "$18.39", category: "Entrees" },
    { name: "Porky Mac", description: "Mac n cheese topped with pulled pork, choice of sauce", price: "$13.79", category: "Entrees" },
    { name: "Crack Chicken Mac", description: "Mac n cheese topped with crack chicken and house BBQ", price: "$14.99", category: "Entrees" },
    { name: "Spicy Crack Chicken Mac", description: "Mac n cheese topped with spicy chicken and BBQ", price: "$16.09", category: "Entrees" },
    { name: "Full Size Gut Buster", description: "6 rib bones, 8 smoked wings, 1/2 lb pulled pork, 1/2 lb crack chicken, 2 sides coleslaw, 2 sides mac", price: "$69.00", category: "Entrees" },
    { name: "1/2 Gut Buster", description: "3 rib bones, 4 smoked wings, 1/4 lb pulled pork, 1/4 lb crack chicken, coleslaw, mac", price: "$37.99", category: "Entrees" },
    { name: "Pulled Pork - A La Carte", description: "Choice of size", price: "$10.00", category: "Entrees" },

    // ── Tacos (5) ────────────────────────────────────────────
    { name: "Crack Chicken Tacos (3pc)", description: "Corn tortilla, crack chicken, onion, cilantro + 1 side", price: "$17.29", category: "Tacos" },
    { name: "Spicy Chicken Tacos (3pc)", description: "Corn tortilla, spicy chicken, onion, cilantro + 1 side", price: "$17.29", category: "Tacos" },
    { name: "Pulled Pork Tacos (3pc)", description: "Corn tortilla, pulled pork, onion, cilantro + 1 side", price: "$17.29", category: "Tacos" },
    { name: "Brisket Tacos (3pc)", description: "Corn tortilla, beef brisket, onion, cilantro + 1 side", price: "$19.59", category: "Tacos" },
    { name: "One of Each Tacos (4pc)", description: "1 crack chicken, 1 spicy chicken, 1 pulled pork, 1 brisket + 1 side", price: "$25.29", category: "Tacos" },

    // ── Nachos (5) ───────────────────────────────────────────
    { name: "Pulled Pork Nachos", description: "Beer queso, pulled pork, jalapeno, lettuce", price: "$17.29", category: "Appetizers" },
    { name: "Crack Chicken Nachos", description: "Beer queso, crack chicken, jalapenos, lettuce", price: "$17.29", category: "Appetizers" },
    { name: "Spicy Chicken Nachos", description: "Beer queso, spicy chicken, jalapenos, lettuce", price: "$17.29", category: "Appetizers" },
    { name: "Brisket Nachos", description: "Beer queso, brisket, jalapenos, lettuce", price: "$19.59", category: "Appetizers" },
    { name: "All The Meats Nachos", description: "Pork, chicken, brisket, beer queso, jalapeno, lettuce", price: "$26.49", category: "Appetizers" },

    // ── Acme Homeruns — Burgers & Sandwiches (11) ────────────
    { name: "ACME Burger", description: "1/2 lb flame-broiled ground brisket, lettuce, tomato, onion, pickle + 1 side", price: "$18.39", category: "Sandwiches" },
    { name: "Onion Sliders (3pc)", description: "3oz brisket patties with marinated grilled onion + 1 side", price: "$14.99", category: "Sandwiches" },
    { name: "Build Your Own BBQ Sliders (3pc)", description: "Choice of protein, house BBQ, slaw topper + 1 side", price: "$14.99", category: "Sandwiches" },
    { name: "Breaded Tenderloin Sandwich", description: "Breaded-fried tenderloin, lettuce, tomato, onion, pickle + 1 side", price: "$17.29", category: "Sandwiches" },
    { name: "Pulled Pork Sandwich", description: "Pulled pork, choice of sauce, slaw topper + 1 side", price: "$14.99", category: "Sandwiches" },
    { name: "Brisket Sandwich", description: "Smoked brisket, slaw, sauce + 1 side", price: "$19.59", category: "Sandwiches" },
    { name: "Chicken Tender Basket (4pc)", description: "4 chicken tenders + 1 side", price: "$16.09", category: "Sandwiches" },
    { name: "Acme Wing Basket (6pc)", description: "6 wings, choice of sauce, carrots, celery, dipping sauce + 1 side", price: "$16.09", category: "Sandwiches" },
    { name: "Crack Chicken Sandwich", description: "Shredded crack chicken, choice of sauce, slaw topper + 1 side", price: "$16.09", category: "Sandwiches" },
    { name: "Spicy Chicken Sandwich", description: "Shredded spicy chicken, choice of sauce, slaw topper + 1 side", price: "$14.00", category: "Sandwiches" },
    { name: "Bahn Mi Burger", description: "Specialty burger with Asian-inspired toppings + 1 side", price: "$16.00", category: "Sandwiches" },

    // ── Hoagies (7) ──────────────────────────────────────────
    { name: "Stromboli (10\")", description: "Marinara, sausage, green pepper, onion, mozzarella + 1 side", price: "$17.29", category: "Sandwiches" },
    { name: "Italian Muffaletta (10\")", description: "Mortadella, salami, capicola, prosciutto, olive salad, smoked provolone + 1 side", price: "$18.39", category: "Sandwiches" },
    { name: "French Dip & Au Jus (10\")", description: "Shaved ribeye, Italian au jus, provolone + 1 side", price: "$20.69", category: "Sandwiches" },
    { name: "Cheese Steak Hoagie (10\")", description: "Shaved ribeye, onion, cheese + 1 side", price: "$17.00", category: "Sandwiches" },
    { name: "Pit Beef Hoagie (10\")", description: "Slow-cooked sirloin, Acme tiger sauce, raw onion + 1 side", price: "$19.59", category: "Sandwiches" },
    { name: "Marbled Rye Reuben", description: "Corned beef, swiss, sauerkraut, russian dressing, toasted sourdough + 1 side", price: "$18.39", category: "Sandwiches" },
    { name: "Acme BLT", description: "Smoked bacon, beef steak tomato, lettuce, mayo, toasted sourdough", price: "$15.00", category: "Sandwiches" },

    // ── Pizza — 14" Large (12 varieties, also available 10"/16") ─
    { name: "Build Your Own Pizza", description: "Choice of crust + toppings. 10\" $11 / 14\" $20.69 / 16\" $24", price: "$20.69", category: "Pizza" },
    { name: "ACME Deluxe Pizza", description: "Sausage, bacon, tomato, pepperoni, olives, red onion, green pepper, mushroom, cheese. 10\" $17.29 / 14\" $25.29 / 16\" $28.79", price: "$25.29", category: "Pizza" },
    { name: "All The Meats Pizza", description: "Ham, pepperoni, bacon, chicken, sausage, pork, cheese. 10\" $18.39 / 14\" $26.49 / 16\" $29.89", price: "$26.49", category: "Pizza" },
    { name: "Taco Bout Speedy Gonzales Pizza", description: "Refried beans, taco beef, Mexican cheese, lettuce, tomato, red onion, Doritos. 10\" $17.29 / 14\" $25.29 / 16\" $28.79", price: "$25.29", category: "Pizza" },
    { name: "The Johnny \"Italian Brisket\" Pizza", description: "Smoked brisket, giardiniera pepper, cheese. 10\" $17.29 / 14\" $25.29 / 16\" $28.79", price: "$25.29", category: "Pizza" },
    { name: "Porky Pig Pizza", description: "Pulled pork, cheese, pickle, BBQ sauce. 10\" $17.29 / 14\" $24.19 / 16\" $27.59", price: "$24.19", category: "Pizza" },
    { name: "Foghorn Leghorn Buffalo Chicken Pizza", description: "Buffalo-ranch, crispy chicken, bleu cheese crumble, green onion. 10\" $17.29 / 14\" $25.29 / 16\" $27.59", price: "$25.29", category: "Pizza" },
    { name: "The Looney Toon CBR Pizza", description: "Ranch, grilled chicken, bacon, cheese. 10\" $17.29 / 14\" $25.29 / 16\" $28.79", price: "$25.29", category: "Pizza" },
    { name: "Bahn Mi Pizza", description: "Sriracha mayo, choice of protein, pickled carrot/radish, cucumber, jalapeno, cilantro, hoisin. 10\" $19.59 / 14\" $27.59 / 16\" $31.09", price: "$27.59", category: "Pizza" },
    { name: "Margherita Pizza", description: "Marinara, sliced mozzarella, diced tomato, fresh basil. 10\" $16.09 / 14\" $23 / 16\" $26.49", price: "$23.00", category: "Pizza" },
    { name: "A La Veg Pizza", description: "Red onion, green pepper, tomato, mushroom, olives, banana pepper, vegan cheese. 10\" $16.09 / 14\" $24.19 / 16\" $27.59", price: "$24.19", category: "Pizza" },
    { name: "Hawaiian Pizza", description: "Ham, diced pepperoni, pineapple, red onion, mozzarella, BBQ. 10\" $16.09 / 14\" $24.19 / 16\" $27.59", price: "$24.19", category: "Pizza" },

    // ── Pizza Rolls (12) ─────────────────────────────────────
    { name: "Build Your Own Roll", description: "Choice of sauce + toppings", price: "$10.00", category: "Pizza" },
    { name: "ACME Deluxe Roll", description: "Sausage, bacon, tomato, pepperoni, olives, onion, pepper, mushroom, cheese", price: "$17.29", category: "Pizza" },
    { name: "All The Meats Roll", description: "Ham, pepperoni, bacon, chicken, sausage, pork, mozzarella", price: "$18.39", category: "Pizza" },
    { name: "Taco Bout Speedy Gonzales Roll", description: "Refried beans, taco beef, Mexican cheese, lettuce, tomato, onion, Doritos", price: "$17.29", category: "Pizza" },
    { name: "Johnny \"Italian Brisket\" Roll", description: "Smoked brisket, giardiniera pepper, mozzarella", price: "$17.29", category: "Pizza" },
    { name: "Porky Pig Roll", description: "Pulled pork, mozzarella, pickle, BBQ sauce", price: "$16.09", category: "Pizza" },
    { name: "Foghorn Leghorn Buffalo Chicken Roll", description: "Buffalo-ranch, chopped chicken tenders, bleu cheese, green onion", price: "$17.29", category: "Pizza" },
    { name: "Looney Toon CBR Roll", description: "Ranch, grilled chicken, bacon, mozzarella", price: "$17.29", category: "Pizza" },
    { name: "Bahn Mi Roll", description: "Sriracha mayo, choice of protein, pickled vegetables, cilantro, hoisin", price: "$19.59", category: "Pizza" },
    { name: "Margherita Roll", description: "Marinara, mozzarella, diced tomato, fresh basil", price: "$16.09", category: "Pizza" },
    { name: "A La Veg Roll", description: "Marinara, veggies, olives, banana pepper, vegan cheese", price: "$16.09", category: "Pizza" },
    { name: "Hawaiian Roll", description: "Ham, pepperoni, pineapple, red onion, mozzarella, BBQ", price: "$16.09", category: "Pizza" },

    // ── Salads (6) ───────────────────────────────────────────
    { name: "Caesar Salad", description: "Romaine, parmesan, croutons, caesar dressing", price: "$11.49", category: "Salads" },
    { name: "Cobb Salad", description: "Romaine, tomato, green onion, bacon, boiled egg, avocado, chicken, blue cheese", price: "$12.69", category: "Salads" },
    { name: "State Street Spinach Salad", description: "Spinach, blue cheese, mandarin orange, green apple, dried cherries, candied pecan, sweet & sour", price: "$12.69", category: "Salads" },
    { name: "House Salad", description: "Romaine, tomato, cucumber, red onion, green pepper, cheddar, choice of dressing", price: "$10.39", category: "Salads" },
    { name: "Italian Salad", description: "Romaine, red onion, tomato, pepperoncini, black olives, parmesan, croutons", price: "$12.69", category: "Salads" },
    { name: "Build Your Own Salad", description: "Choice of greens, up to 4 toppings, cheese, dressing", price: "$9.19", category: "Salads" },

    // ── Sunday Brunch (8) — 11am-2pm ─────────────────────────
    { name: "Todd's Hangover Hoagie", description: "10\" hoagie, scrambled egg, sausage, sriracha, mayo, avocado + 1 side (Sun brunch)", price: "$14.99", category: "Specials" },
    { name: "Eggs Your Way", description: "2 eggs your way, breakfast meat, toast (Sun brunch)", price: "$9.19", category: "Specials" },
    { name: "Acme Tenderloin Benedict", description: "8oz breaded tenderloin, Texas toast, chorizo sausage gravy, cheddar, 2 eggs over easy (Sun brunch)", price: "$14.99", category: "Specials" },
    { name: "Old School Breakfast", description: "2 eggs, bacon, sausage patties, home fries, biscuit, chorizo gravy (Sun brunch)", price: "$13.79", category: "Specials" },
    { name: "Brisket Manhattan", description: "Home fries, brisket, over easy egg, chorizo sausage gravy (Sun brunch)", price: "$16.09", category: "Specials" },
    { name: "Sausage Gravy & Biscuits", description: "Biscuits with chorizo sausage gravy (Sun brunch)", price: "$6.89", category: "Specials" },
    { name: "Loaded Omelette Pizza", description: "Scrambled egg, ham, bacon, peppers, green onion, tomato, mozzarella, asiago (Sun brunch)", price: "$17.29", category: "Specials" },
    { name: "Smoked Sausage & Gravy Pizza", description: "Chorizo sausage, gravy, green onion, asiago, mozzarella (Sun brunch)", price: "$16.09", category: "Specials" },

    // ── Kids Menu (9) ────────────────────────────────────────
    { name: "Chicken Fingers & Fries (Kids)", description: "2 tenders + 1 side + drink", price: "$10.39", category: "Kids Menu" },
    { name: "Pulled Pork Sandwich (Kids)", description: "Pulled pork sandwich, BBQ + 1 side + drink", price: "$10.39", category: "Kids Menu" },
    { name: "Baby Back Ribs (Kids)", description: "2 ribs, BBQ + 1 side + drink", price: "$11.49", category: "Kids Menu" },
    { name: "Jumbo Wings (Kids)", description: "3 jumbo wings + 1 side + drink", price: "$10.39", category: "Kids Menu" },
    { name: "Crack Chicken Sandwich (Kids)", description: "Crack chicken sandwich + 1 side + drink", price: "$10.39", category: "Kids Menu" },
    { name: "Mac N Cheese (Kids)", description: "6oz mac n cheese + 1 side + drink", price: "$11.49", category: "Kids Menu" },
    { name: "Kids Burger", description: "4oz beef patty + 1 side + drink", price: "$11.49", category: "Kids Menu" },
    { name: "Breaded Tenderloin (Kids)", description: "6oz breaded tenderloin, lettuce, tomato, onion, pickle + 1 side + drink", price: "$12.69", category: "Kids Menu" },
    { name: "Brisket Sandwich (Kids)", description: "4oz brisket sandwich + 1 side + drink", price: "$13.79", category: "Kids Menu" },

    // ── Sides (7) ────────────────────────────────────────────
    { name: "Smoked Coleslaw", description: "6oz house-smoked coleslaw", price: "$4.59", category: "Sides" },
    { name: "French Fries", description: "Classic fries", price: "$5.79", category: "Sides" },
    { name: "Sweet Potato Fries", description: "Crispy sweet potato fries", price: "$6.79", category: "Sides" },
    { name: "Mac N Cheese (Side)", description: "Creamy mac and cheese", price: "$6.79", category: "Sides" },
    { name: "Street Corn (Side)", description: "Served cold", price: "$6.79", category: "Sides" },
    { name: "Jalapeno Cornbread (2pc)", description: "House-made jalapeno cornbread", price: "$3.49", category: "Sides" },
    { name: "Beer Queso (Side)", description: "Choice of size", price: "$4.59", category: "Sides" },

    // ── Desserts (4) ─────────────────────────────────────────
    { name: "New York Style Cheesecake", description: "Individual serving", price: "$6.89", category: "Desserts" },
    { name: "Featured Cheesecake", description: "Individual serving — selection varies", price: "$9.19", category: "Desserts" },
    { name: "Cinnamon Sugar Dough Puffs", description: "Baked sourdough, cinnamon sugar, icing", price: "$9.19", category: "Desserts" },
    { name: "Yogi Bear's Apple Pie Dessert Pizza", description: "12\" — cream cheese, apple pie filling, streusel crumble, icing, powdered sugar", price: "$16.09", category: "Desserts" },
  ];

  let count = 0;
  for (const item of menuItems) {
    await addDoc(collection(db, "menu_items"), {
      ...item,
      accountId,
      available: true,
      image: null,
      createdAt: serverTimestamp(),
    });
    count++;
    if (count % 25 === 0) console.log(`  ... ${count} items written`);
  }

  console.log(`  ✓ ${menuItems.length} menu items added to ACME Bar & Grill`);
  console.log("\n✅ Done!");
  process.exit(0);
}

updateAcmeMenu().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
