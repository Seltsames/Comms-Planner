// DRV -----------------------------------------------------------------------
export const DRV_TEAMS_HIERARCHY = [
  {
    team: "Brand Connection",
    subTeams: ["Branding and Experiential", "Channel Experience", "Experiential and Channels"],
  },
  {
    team: "Growth",
    subTeams: ["Volume and Quality", "Franchises", "Communities", "Offline", "Premier", "Fleet"],
  },
  { team: "Engagement", subTeams: ["Loyalty", "Earnings OPS"] },
  { team: "Experience", subTeams: ["Safety and Service Governance"] },
] as const;

export const DRV_TEAMS = DRV_TEAMS_HIERARCHY.map((t) => t.team);

// PAX -----------------------------------------------------------------------
// PAX has six top-level teams and NO sub-teams — the hierarchy is flat.
export const PAX_TEAMS = [
  "Brand Field",
  "Growth",
  "Product",
  "AR HUB + InEx",
  "Premier",
  "Índigo",
] as const;

export type PaxTeam = (typeof PAX_TEAMS)[number];

// Unified type for code that handles both sides.
export interface TeamNode {
  team: string;
  subTeams: readonly string[];
}

export const TEAMS_BY_KIND = {
  drv: DRV_TEAMS_HIERARCHY.map((t) => ({ team: t.team, subTeams: t.subTeams })),
  pax: PAX_TEAMS.map((t) => ({ team: t, subTeams: [] as const })),
} as const satisfies Record<"drv" | "pax", readonly TeamNode[]>;

export const COMM_TYPES = {
  POPE: "Pope",
  AD_PLACEMENT: "Ad Placement",
} as const;

export type CommType = (typeof COMM_TYPES)[keyof typeof COMM_TYPES];

// POPE channels are shared by both audiences; Ad Placement diverges per side.
const POPE_CHANNELS = ["Push in/out", "Push in", "Push out", "Email", "Whatsapp", "SMS"];

export const ACTION_KEYS_BY_KIND: Record<"drv" | "pax", Record<CommType, string[]>> = {
  drv: {
    [COMM_TYPES.POPE]: POPE_CHANNELS,
    [COMM_TYPES.AD_PLACEMENT]: ["Pop Up", "XPanel"],
  },
  pax: {
    [COMM_TYPES.POPE]: POPE_CHANNELS,
    [COMM_TYPES.AD_PLACEMENT]: [
      "Promo zone",
      "Welfare big",
      "Welfare small",
      "Broadcast MKT area",
      "OpenScreen",
      "Promo banner",
      "Pop Up",
    ],
  },
};

export const COUNTRIES = ["MX", "CO", "PE", "CR", "CL", "AR", "EC", "DO"] as const;
export type Country = (typeof COUNTRIES)[number];

export const TIMEZONES: Record<Country, string> = {
  MX: "GMT-6 (CDMX)",
  CO: "GMT-5 (Bogotá)",
  PE: "GMT-5 (Lima)",
  CR: "GMT-6 (San José)",
  CL: "GMT-3 (Santiago)",
  AR: "GMT-3 (Buenos Aires)",
  EC: "GMT-5 (Quito)",
  DO: "GMT-4 (Santo Domingo)",
};

export interface City {
  id: string;
  name: string;
  country: Country;
}

// CSV validators ---------------------------------------------------------
// DRV IDs are 15 digits starting with 6509.
// PAX IDs are 14-digit integers starting with 87. When PAX IDs are
// exported to spreadsheets like Excel they render as scientific notation
// (e.g. 8.79616E+13) but the underlying CSV has the full 14-digit integer.
// Kept separate so each side can diverge further without touching every
// consumer.
export const CSV_VALIDATORS = {
  drv: {
    idField: "drv_id" as const,
    regex: /^6509\d{11}$/,
    label: "DRV ID",
    hint: "15 dígitos, empieza con 6509",
  },
  pax: {
    idField: "pax_id" as const,
    regex: /^87\d{12}$/,
    label: "PAX ID",
    hint: "14 dígitos, empieza con 87",
  },
} as const;

const RAW_CITIES: City[] = [
  // Argentina (AR)
  { id: "54020200", name: "Resistencia", country: "AR" },
  { id: "54030100", name: "Córdoba", country: "AR" },
  { id: "54050400", name: "La Plata", country: "AR" },
  { id: "54051800", name: "Mar del Plata", country: "AR" },
  { id: "54052300", name: "Buenos Aires", country: "AR" },
  { id: "54120300", name: "Paraná", country: "AR" },
  { id: "54130400", name: "Salta", country: "AR" },
  { id: "54150200", name: "Posadas", country: "AR" },
  { id: "54160100", name: "Rosario", country: "AR" },
  { id: "54160400", name: "Santa Fe", country: "AR" },
  { id: "54170300", name: "Tucumán", country: "AR" },
  { id: "54010100", name: "Mendoza", country: "AR" },
  { id: "54010200", name: "San Juan", country: "AR" },
  { id: "54010300", name: "Corrientes", country: "AR" },
  { id: "54010400", name: "San Salvador de Jujuy", country: "AR" },
  { id: "54010500", name: "Bahía Blanca", country: "AR" },
  { id: "54010600", name: "Santiago del Estero", country: "AR" },
  { id: "54010700", name: "Neuquén", country: "AR" },
  { id: "54010800", name: "Formosa", country: "AR" },
  { id: "54010900", name: "La Rioja", country: "AR" },
  { id: "54011000", name: "Comodoro Rivadavia", country: "AR" },
  { id: "54011100", name: "San Luis", country: "AR" },
  { id: "54011200", name: "San Fernando del Valle de Catamarca", country: "AR" },
  { id: "54011300", name: "Río Cuarto", country: "AR" },
  { id: "54011400", name: "Concordia", country: "AR" },
  { id: "54011500", name: "San Nicolás de los Arroyos", country: "AR" },
  { id: "54011600", name: "San Rafael", country: "AR" },
  { id: "54011700", name: "Tandil", country: "AR" },
  { id: "54011800", name: "Villa Mercedes", country: "AR" },
  { id: "54011900", name: "San Carlos de Bariloche", country: "AR" },
  { id: "54012000", name: "Pergamino", country: "AR" },
  { id: "54012100", name: "Santa Rosa", country: "AR" },
  // Chile (CL)
  { id: "56490200", name: "Copiapó", country: "CL" },
  { id: "56512100", name: "Los Andes-San Felipe", country: "CL" },
  { id: "56513800", name: "Valparaíso", country: "CL" },
  { id: "56530300", name: "Temuco", country: "CL" },
  { id: "56550200", name: "Valdivia", country: "CL" },
  { id: "56570400", name: "Talca", country: "CL" },
  { id: "56580200", name: "Ovalle", country: "CL" },
  { id: "56580300", name: "La Serena-Coquimbo", country: "CL" },
  { id: "56590200", name: "Iquique", country: "CL" },
  { id: "56600300", name: "Puerto Montt", country: "CL" },
  { id: "56600400", name: "Osorno", country: "CL" },
  { id: "56610300", name: "Antofagasta", country: "CL" },
  { id: "56010100", name: "Santiago", country: "CL" },
  { id: "56010200", name: "Concepción", country: "CL" },
  { id: "56010300", name: "Puente Alto", country: "CL" },
  { id: "56010400", name: "Viña del Mar", country: "CL" },
  { id: "56010500", name: "Talcahuano", country: "CL" },
  { id: "56010600", name: "San Bernardo", country: "CL" },
  { id: "56010700", name: "Rancagua", country: "CL" },
  { id: "56010800", name: "Arica", country: "CL" },
  { id: "56010900", name: "Chillán", country: "CL" },
  { id: "56011000", name: "Calama", country: "CL" },
  { id: "56011100", name: "Quilpué", country: "CL" },
  { id: "56011200", name: "Los Ángeles", country: "CL" },
  { id: "56011300", name: "Punta Arenas", country: "CL" },
  { id: "56011400", name: "Curicó", country: "CL" },
  // Colombia (CO)
  { id: "57330100", name: "Cali", country: "CO" },
  { id: "57380100", name: "Bogotá, D.C.", country: "CO" },
  { id: "57390100", name: "Cúcuta", country: "CO" },
  { id: "57680001", name: "Bucaramanga", country: "CO" },
  { id: "57010100", name: "Medellín", country: "CO" },
  { id: "57010200", name: "Barranquilla", country: "CO" },
  { id: "57010300", name: "Cartagena", country: "CO" },
  { id: "57010400", name: "Ibagué", country: "CO" },
  { id: "57010500", name: "Valledupar", country: "CO" },
  { id: "57010600", name: "Pereira", country: "CO" },
  { id: "57010700", name: "Villavicencio", country: "CO" },
  { id: "57010800", name: "Santa Marta", country: "CO" },
  { id: "57010900", name: "Buenaventura", country: "CO" },
  { id: "57011000", name: "Manizales", country: "CO" },
  { id: "57011100", name: "Montería", country: "CO" },
  { id: "57011200", name: "Armenia", country: "CO" },
  { id: "57011300", name: "Pasto", country: "CO" },
  { id: "57011400", name: "Neiva", country: "CO" },
  { id: "57011500", name: "Sincelejo", country: "CO" },
  { id: "57011600", name: "Popayán", country: "CO" },
  { id: "57011700", name: "Palmira", country: "CO" },
  { id: "57011800", name: "Barrancabermeja", country: "CO" },
  { id: "57011900", name: "Tuluá", country: "CO" },
  { id: "57012000", name: "Florencia", country: "CO" },
  { id: "57012100", name: "Sogamoso", country: "CO" },
  { id: "57012200", name: "Tunja", country: "CO" },
  // Costa Rica (CR)
  { id: "506010100", name: "San Carlos", country: "CR" },
  { id: "506030100", name: "Liberia", country: "CR" },
  { id: "506070100", name: "San José", country: "CR" },
  { id: "506010200", name: "Alajuela", country: "CR" },
  { id: "506010300", name: "Heredia", country: "CR" },
  { id: "506010400", name: "Cartago", country: "CR" },
  { id: "506010500", name: "Puntarenas", country: "CR" },
  { id: "506010600", name: "Limón", country: "CR" },
  // República Dominicana (DO)
  { id: "809190100", name: "Santiago de los Caballeros", country: "DO" },
  { id: "809230100", name: "Santo Domingo", country: "DO" },
  { id: "809010100", name: "Santo Domingo Oeste", country: "DO" },
  { id: "809010200", name: "Santo Domingo Este", country: "DO" },
  { id: "809010300", name: "San Pedro de Macorís", country: "DO" },
  { id: "809010400", name: "La Romana", country: "DO" },
  { id: "809010500", name: "San Cristóbal", country: "DO" },
  { id: "809010600", name: "Puerto Plata", country: "DO" },
  { id: "809010700", name: "San Francisco de Macorís", country: "DO" },
  { id: "809010800", name: "Higüey", country: "DO" },
  { id: "809010900", name: "La Vega", country: "DO" },
  // Ecuador (EC)
  { id: "593071200", name: "Guayaquil", country: "EC" },
  { id: "593080100", name: "Quito", country: "EC" },
  { id: "593010100", name: "Cuenca", country: "EC" },
  { id: "593010200", name: "Machala", country: "EC" },
  { id: "593010300", name: "Manta", country: "EC" },
  { id: "593010400", name: "Portoviejo", country: "EC" },
  { id: "593010500", name: "Santo Domingo de los Colorados", country: "EC" },
  { id: "593010600", name: "Ibarra", country: "EC" },
  { id: "593010700", name: "Quevedo", country: "EC" },
  { id: "593010800", name: "Loja", country: "EC" },
  { id: "593010900", name: "Ambato", country: "EC" },
  { id: "593011000", name: "Esmeraldas", country: "EC" },
  { id: "593011100", name: "Riobamba", country: "EC" },
  { id: "593011200", name: "Milagro", country: "EC" },
  // México (MX)
  { id: "52010100", name: "Aguascalientes", country: "MX" },
  { id: "52020100", name: "Mexicali", country: "MX" },
  { id: "52020200", name: "Tijuana", country: "MX" },
  { id: "52020300", name: "Ensenada", country: "MX" },
  { id: "52030200", name: "La Paz", country: "MX" },
  { id: "52050400", name: "Torreón", country: "MX" },
  { id: "52050500", name: "Saltillo", country: "MX" },
  { id: "52060100", name: "Colima", country: "MX" },
  { id: "52060200", name: "Manzanillo", country: "MX" },
  { id: "52071100", name: "Tuxtla Gutiérrez", country: "MX" },
  { id: "52080200", name: "Chihuahua", country: "MX" },
  { id: "52080800", name: "Juárez", country: "MX" },
  { id: "52090100", name: "Ciudad de México", country: "MX" },
  { id: "52100100", name: "Guadalajara", country: "MX" },
  { id: "52100200", name: "Monterrey", country: "MX" },
  { id: "52100300", name: "Puebla", country: "MX" },
  { id: "52100400", name: "Toluca", country: "MX" },
  { id: "52100500", name: "San Luis Potosí", country: "MX" },
  { id: "52100600", name: "Mérida", country: "MX" },
  { id: "52100700", name: "León", country: "MX" },
  { id: "52100800", name: "Cuernavaca", country: "MX" },
  { id: "52100900", name: "Tampico", country: "MX" },
  { id: "52101000", name: "Cancún", country: "MX" },
  { id: "52101100", name: "Acapulco", country: "MX" },
  { id: "52101200", name: "Morelia", country: "MX" },
  { id: "52101300", name: "Reynosa", country: "MX" },
  { id: "52101400", name: "Veracruz", country: "MX" },
  { id: "52101500", name: "Villahermosa", country: "MX" },
  { id: "52101600", name: "Hermosillo", country: "MX" },
  { id: "52101700", name: "Culiacán", country: "MX" },
  { id: "52101800", name: "Celaya", country: "MX" },
  { id: "52101900", name: "Pachuca", country: "MX" },
  { id: "52102000", name: "Oaxaca", country: "MX" },
  { id: "52102100", name: "Querétaro", country: "MX" },
  { id: "52102200", name: "Matamoros", country: "MX" },
  { id: "52102300", name: "Tepic", country: "MX" },
  { id: "52102400", name: "Puerto Vallarta", country: "MX" },
  { id: "52102500", name: "Durango", country: "MX" },
  { id: "52102600", name: "Orizaba", country: "MX" },
  { id: "52102700", name: "Mazatlán", country: "MX" },
  { id: "52102800", name: "Irapuato", country: "MX" },
  { id: "52102900", name: "Cuautla", country: "MX" },
  { id: "52103000", name: "Nuevo Laredo", country: "MX" },
  { id: "52103100", name: "Xalapa", country: "MX" },
  { id: "52103200", name: "Ciudad Obregón", country: "MX" },
  { id: "52103300", name: "Zacatecas", country: "MX" },
  { id: "52103400", name: "Ciudad Victoria", country: "MX" },
  { id: "52103500", name: "Monclova", country: "MX" },
  { id: "52103600", name: "Córdoba", country: "MX" },
  { id: "52103700", name: "Tehuacán", country: "MX" },
  { id: "52103800", name: "Tapachula", country: "MX" },
  { id: "52103900", name: "Uruapan", country: "MX" },
  { id: "52104000", name: "Los Mochis", country: "MX" },
  { id: "52104100", name: "Chilpancingo", country: "MX" },
  { id: "52104200", name: "Campeche", country: "MX" },
  { id: "52104300", name: "Tlaxcala", country: "MX" },
  { id: "52104400", name: "Zamora", country: "MX" },
  { id: "52104500", name: "Chetumal", country: "MX" },
  { id: "52104600", name: "Nogales", country: "MX" },
  { id: "52104700", name: "Playa del Carmen", country: "MX" },
  { id: "52104800", name: "Piedras Negras", country: "MX" },
  { id: "52104900", name: "Ciudad del Carmen", country: "MX" },
  { id: "52105000", name: "Guanajuato", country: "MX" },
  { id: "52105100", name: "San Cristóbal de las Casas", country: "MX" },
  { id: "52105200", name: "San Luis Río Colorado", country: "MX" },
  { id: "52105300", name: "Salamanca", country: "MX" },
  { id: "52105400", name: "San Juan del Río", country: "MX" },
  { id: "52105500", name: "Fresnillo", country: "MX" },
  { id: "52105600", name: "Ciudad Valles", country: "MX" },
  { id: "52105700", name: "Cuauhtémoc", country: "MX" },
  { id: "52105800", name: "Navojoa", country: "MX" },
  { id: "52105900", name: "Lagos de Moreno", country: "MX" },
  { id: "52106000", name: "San José del Cabo", country: "MX" },
  { id: "52106100", name: "Tulancingo", country: "MX" },
  { id: "52106200", name: "Coatzacoalcos", country: "MX" },
  { id: "52106300", name: "Minatitlán", country: "MX" },
  // Perú (PE)
  { id: "51010100", name: "Lima", country: "PE" },
  { id: "51010200", name: "Arequipa", country: "PE" },
  { id: "51010300", name: "Trujillo", country: "PE" },
  { id: "51010400", name: "Callao", country: "PE" },
  { id: "51010500", name: "Chiclayo", country: "PE" },
  { id: "51010600", name: "Cusco", country: "PE" },
  { id: "51010700", name: "Piura", country: "PE" },
  { id: "51010800", name: "Iquitos", country: "PE" },
  { id: "51010900", name: "Chimbote", country: "PE" },
  { id: "51011000", name: "Huancayo", country: "PE" },
  { id: "51011100", name: "Tacna", country: "PE" },
  { id: "51011200", name: "Pucallpa", country: "PE" },
  { id: "51011300", name: "Ica", country: "PE" },
  { id: "51011400", name: "Juliaca", country: "PE" },
  { id: "51011500", name: "Sullana", country: "PE" },
  { id: "51011600", name: "Chincha Alta", country: "PE" },
  { id: "51011700", name: "Huánuco", country: "PE" },
  { id: "51011800", name: "Ayacucho", country: "PE" },
  { id: "51011900", name: "Cajamarca", country: "PE" },
  { id: "51012000", name: "Puno", country: "PE" },
  { id: "51012100", name: "Tumbes", country: "PE" },
];

export const CITIES_DATA: City[] = [...RAW_CITIES].sort(
  (a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name),
);
