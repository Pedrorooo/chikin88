// Catálogo local que coincide con el seed del SQL.
// La app intenta cargar productos desde Supabase, y si falla
// (o el catálogo está vacío) usará este como respaldo.

export const PRODUCTS = [
  // Principales
  { name: 'Combo XXL',            category: 'Principales', price:  8.50, allows_extras: true,  free_sauces: 1 },
  { name: 'Combo Full',           category: 'Principales', price: 16.50, allows_extras: true,  free_sauces: 3 },
  { name: 'Combo Económico',      category: 'Principales', price:  3.50, allows_extras: true,  free_sauces: 1 },
  { name: 'Combo Especial',       category: 'Principales', price:  5.50, allows_extras: true,  free_sauces: 1 },
  // Ramen
  { name: 'Ramen solo',           category: 'Ramen',       price:  5.50, allows_extras: false, free_sauces: 0 },
  { name: 'Combo ramen',          category: 'Ramen',       price:  7.50, allows_extras: true,  free_sauces: 1 },
  { name: 'Ramen sin preparar',   category: 'Ramen',       price:  4.50, allows_extras: false, free_sauces: 0 },
  // Bebidas
  { name: 'Agua',                 category: 'Bebidas',     price:  0.75, allows_extras: false, free_sauces: 0 },
  { name: 'Bebida pequeña',       category: 'Bebidas',     price:  0.50, allows_extras: false, free_sauces: 0 },
  { name: 'Bebida grande',        category: 'Bebidas',     price:  1.25, allows_extras: false, free_sauces: 0 },
  { name: 'Bebida coreana funda', category: 'Bebidas',     price:  3.00, allows_extras: false, free_sauces: 0 },
  { name: 'Bebida coreana lata',  category: 'Bebidas',     price:  3.50, allows_extras: false, free_sauces: 0 },
  // Extras
  { name: 'Palillos',             category: 'Extras',      price:  0.25, allows_extras: false, free_sauces: 0 },
  { name: 'Vaso de hielos',       category: 'Extras',      price:  0.50, allows_extras: false, free_sauces: 0 },
  { name: 'Pockys',               category: 'Extras',      price:  3.50, allows_extras: false, free_sauces: 0 },
  { name: 'Dulces',               category: 'Extras',      price:  1.50, allows_extras: false, free_sauces: 0 },
  { name: 'Gomitas Peel',         category: 'Extras',      price:  3.50, allows_extras: false, free_sauces: 0 },
  { name: 'Porción de papas',     category: 'Extras',      price:  1.50, allows_extras: false, free_sauces: 0 },
  { name: 'Caja extra',           category: 'Extras',      price:  0.25, allows_extras: false, free_sauces: 0 },
]

export const CATEGORIES = ['Principales', 'Ramen', 'Bebidas', 'Extras']

// Categorías cuyo producto admite la opción de tipo de ramen (picante/carbonara)
export const RAMEN_CATEGORIES = ['Ramen']

// Helper: ¿este producto es ramen?
export const isRamenProduct = (product) =>
  product?.category === 'Ramen' ||
  product?.product_category === 'Ramen'

// Helper: ¿este producto es de pollo (admite modo de salsa)?
export const isChickenProduct = (product) =>
  product?.category === 'Principales' ||
  product?.product_category === 'Principales'
