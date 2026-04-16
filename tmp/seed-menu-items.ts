import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { firebaseConfig } from "../scripts/firebase-config";

const app = initializeApp(firebaseConfig);

interface MenuItem {
  name: string;
  description: string | null;
  price: string;
  category: string;
  available: boolean;
}

const menuItems: MenuItem[] = [
  // ─── Appetizers ───────────────────────────────────────────
  { name: "Breadsticks", description: "Handmade breadsticks, baked golden brown, drizzled with garlic butter, and served with your choice of two dipping sauces.", price: "$7.19", category: "Appetizers", available: true },
  { name: "Bosco Sticks (4 Pc.)", description: "Four breadsticks filled with mozzarella cheese, toasted golden brown, and served with your choice of two dipping sauces.", price: "$10.79", category: "Appetizers", available: true },
  { name: "Garlic Cheese Bread", description: "Our hand made dough, garlic butter, loaded with cheese, and toasted golden brown. Served with a side of marinara.", price: "$10.55", category: "Appetizers", available: true },
  { name: "Bruschetta", description: "Roma tomatoes, onions, garlic, and fresh basil marinated with a blend of spices on toasted ciabatta bread.", price: "$9.59", category: "Appetizers", available: true },
  { name: "Meatball Appetizer", description: "Two hand-rolled meatballs, Mancini peppers, and meat sauce baked under a blanket of mozzarella. Served with toasted ciabatta bread.", price: "$11.99", category: "Appetizers", available: true },
  { name: "Three Meat Cuscino", description: "A quarter-pound meatball, Italian sausage, pepperoni, marinara, and mozzarella baked in fresh dough. Served with a side of marinara.", price: "$10.79", category: "Appetizers", available: true },
  { name: "House Potatoes", description: "Home-Style Potatoes, ground sausage, onion, and Mancini pepper topped with garlic butter and grated Parmesan.", price: "$7.19", category: "Appetizers", available: true },
  { name: "Sausage, Chicken, and Peppers", description: "Italian sausage, chicken breast, bell pepper, onion, and Mancini peppers simmered in marinara. Served with toasted ciabatta bread.", price: "$19.19", category: "Appetizers", available: true },
  { name: "Mussels Marinara", description: "A pound of mussels simmered in light tomato garlic and basil broth. Served with toasted ciabatta bread.", price: "$15.59", category: "Appetizers", available: true },
  { name: "Vulsini Scampi", description: "Tender shrimp simmered in a marinara cream sauce with homemade giardiniera and topped with parsley served over capellini. Served with toasted ciabatta bread.", price: "$16.79", category: "Appetizers", available: true },
  { name: "Seasonal Veggies", description: "Ask server for details.", price: "$6.95", category: "Appetizers", available: true },

  // ─── Tossed Pasta ─────────────────────────────────────────
  { name: "Fettuccine Alfredo (Full)", description: "Home-made Alfredo sauce seasoned with fresh garlic butter, black pepper, and Pecorino Romano cheese tossed with fettuccine.", price: "$16.79", category: "Tossed Pasta", available: true },
  { name: "Fettuccine Alfredo (Half)", description: "Home-made Alfredo sauce seasoned with fresh garlic butter, black pepper, and Pecorino Romano cheese tossed with fettuccine.", price: "$13.19", category: "Tossed Pasta", available: true },
  { name: "Alfredo Especial (Full)", description: "Fettuccine Alfredo tossed with bacon, green peas, roasted red peppers, and crushed red pepper.", price: "$19.19", category: "Tossed Pasta", available: true },
  { name: "Alfredo Especial (Half)", description: "Fettuccine Alfredo tossed with bacon, green peas, roasted red peppers, and crushed red pepper.", price: "$14.39", category: "Tossed Pasta", available: true },
  { name: "Spaghetti and Meatball (Full)", description: "A generous serving of spaghetti in rich meat sauce served with two home-made meatballs.", price: "$17.99", category: "Tossed Pasta", available: true },
  { name: "Spaghetti and Meatball (Half)", description: "A generous serving of spaghetti in rich meat sauce served with one home-made meatball.", price: "$14.39", category: "Tossed Pasta", available: true },
  { name: "Spaghetti and Sauce (Full)", description: "A generous serving of spaghetti in rich meat sauce.", price: "$16.79", category: "Tossed Pasta", available: true },
  { name: "Spaghetti Supreme (Full)", description: "Spaghetti topped with meat sauce, Italian sausage, meatball, mushrooms, and Mancini peppers.", price: "$20.39", category: "Tossed Pasta", available: true },
  { name: "Cavatelli and Sausage (Full)", description: "Cavatelli pasta with Italian sausage in our rich meat sauce.", price: "$19.19", category: "Tossed Pasta", available: true },
  { name: "Cheese Tortellini (Full)", description: "Cheese-filled tortellini tossed in garlic butter, roasted red peppers, spinach, and mushrooms.", price: "$19.19", category: "Tossed Pasta", available: true },
  { name: "Cheese Tortellini (Half)", description: "Cheese-filled tortellini tossed in garlic butter, roasted red peppers, spinach, and mushrooms.", price: "$15.59", category: "Tossed Pasta", available: true },
  { name: "Spinach Filled Ravioli (Full)", description: "Spinach-filled ravioli in your choice of sauce.", price: "$19.19", category: "Tossed Pasta", available: true },
  { name: "Linguini with Chopped Clams (Full)", description: "Linguini tossed with chopped clams in your choice of red or white sauce.", price: "$20.39", category: "Tossed Pasta", available: true },

  // ─── Baked Pasta ──────────────────────────────────────────
  { name: "Baked Ziti (Full)", description: "Ziti baked with meat sauce and a blend of mozzarella and ricotta cheeses.", price: "$17.99", category: "Baked Pasta", available: true },
  { name: "Baked Ziti (Half)", description: "Ziti baked with meat sauce and a blend of mozzarella and ricotta cheeses.", price: "$13.19", category: "Baked Pasta", available: true },
  { name: "Sausage and Peppers Baked Ziti (Full)", description: "Baked ziti with Italian sausage, Mancini peppers, meat sauce, mozzarella, and ricotta.", price: "$20.39", category: "Baked Pasta", available: true },
  { name: "Baked Spaghetti Parmesan (Full)", description: "Spaghetti baked with meat sauce, mozzarella, and Parmesan.", price: "$19.19", category: "Baked Pasta", available: true },
  { name: "Lasagna (Full)", description: "Layers of pasta, meat sauce, ricotta, and mozzarella baked to perfection.", price: "$19.99", category: "Baked Pasta", available: true },
  { name: "Chicken Parmesan (Full)", description: "Breaded chicken breast topped with marinara and melted mozzarella, served over spaghetti.", price: "$22.79", category: "Baked Pasta", available: true },

  // ─── Calzones ─────────────────────────────────────────────
  { name: "Create Your Own Calzone", description: "Folded pizza dough filled with mozzarella and your choice of toppings, baked golden brown. Served with a side of marinara.", price: "$15.59", category: "Calzones", available: true },

  // ─── Salads ───────────────────────────────────────────────
  { name: "House Salad", description: "Mixed greens, tomato, red onion, cucumber, croutons, and your choice of dressing.", price: "$7.99", category: "Salads", available: true },
  { name: "Caesar Salad", description: "Romaine lettuce, Parmesan, croutons, and Caesar dressing.", price: "$9.99", category: "Salads", available: true },
  { name: "Chopped Salad", description: "Chopped romaine, salami, tomato, chickpeas, mozzarella, and Italian dressing.", price: "$13.99", category: "Salads", available: true },

  // ─── Sandwiches ───────────────────────────────────────────
  { name: "Meatball Sub", description: "Home-made meatballs with marinara and melted mozzarella on our home-made flatbread. Served with a side.", price: "$14.99", category: "Sandwiches", available: true },
  { name: "Italian Sub", description: "Salami, ham, pepperoni, lettuce, tomato, onion, and Italian dressing on our home-made flatbread. Served with a side.", price: "$14.99", category: "Sandwiches", available: true },
  { name: "Chicken Parmesan Sandwich", description: "Breaded chicken breast with marinara and mozzarella on our home-made flatbread. Served with a side.", price: "$15.99", category: "Sandwiches", available: true },

  // ─── Sides ────────────────────────────────────────────────
  { name: "Side of Meatballs (2)", description: "Two of our hand-rolled meatballs.", price: "$6.99", category: "Sides", available: true },
  { name: "Side of Sausage", description: "Italian sausage link.", price: "$5.99", category: "Sides", available: true },
  { name: "Side of Meat Sauce", description: "Our rich, slow-simmered meat sauce.", price: "$3.99", category: "Sides", available: true },
  { name: "Extra Dipping Sauce", description: "Marinara, Alfredo, or ranch.", price: "$1.49", category: "Sides", available: true },

  // ─── Desserts ─────────────────────────────────────────────
  { name: "Moscato Berry Tiramisu (Slice)", description: "House-made tiramisu with Moscato-soaked ladyfingers and mixed berries.", price: "$10.79", category: "Desserts", available: true },
  { name: "New York Style Cheesecake", description: "Classic New York style cheesecake.", price: "$9.59", category: "Desserts", available: true },
  { name: "Cannoli", description: "Crispy shell filled with sweet ricotta cream.", price: "$7.99", category: "Desserts", available: true },

  // ─── Beverages ────────────────────────────────────────────
  { name: "Fountain Drink", description: "Pepsi, Diet Pepsi, Mountain Dew, Sierra Mist, Dr. Pepper, Lemonade, Iced Tea.", price: "$3.49", category: "Beverages", available: true },
  { name: "Italian Soda", description: "Sparkling water with your choice of flavored syrup.", price: "$4.49", category: "Beverages", available: true },
];

async function run() {
  const db = getFirestore(app);

  const q = query(
    collection(db, "accounts"),
    where("company", "==", "Salvatori's Italian Eatery")
  );
  const snap = await getDocs(q);

  if (snap.empty) {
    console.error("Could not find Salvatori's account in Firestore");
    process.exit(1);
  }

  const accountId = snap.docs[0].id;
  console.log(`Found Salvatori's account: ${accountId}\n`);

  let count = 0;
  for (const item of menuItems) {
    await addDoc(collection(db, "menu_items"), {
      ...item,
      image: null,
      accountId,
      createdAt: serverTimestamp(),
    });
    count++;
    process.stdout.write(`\r  Adding menu items... ${count}/${menuItems.length}`);
  }

  console.log(`\n\n✓ Added ${count} menu items to Salvatori's account`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
