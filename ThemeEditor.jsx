// ThemeEditor.jsx — full-screen color theme editor.
// Visible only in editor mode. Lets the user tweak every color, save named
// custom themes to localStorage, and switch between presets.

const THEME_STORAGE_KEY = "inventario-themes-v1";

// Every color slot wired to a CSS variable. Grouped for the UI.
const COLOR_GROUPS = [
  {
    title: "Fondo de la sala",
    desc: "Degradado radial detrás de los armarios.",
    items: [
      { key: "bgApp1", label: "Centro (claro)", varName: "--bg-app-1" },
      { key: "bgApp2", label: "Medio",          varName: "--bg-app-2" },
      { key: "bgApp3", label: "Bordes (oscuro)",varName: "--bg-app-3" },
      { key: "bg0",    label: "Base",           varName: "--bg-0" },
    ],
  },
  {
    title: "Suelo y luz",
    items: [
      { key: "floor1", label: "Suelo claro", varName: "--floor-1" },
      { key: "floor2", label: "Suelo oscuro",varName: "--floor-2" },
      { key: "wallLight", label: "Luz pared",varName: "--wall-light" },
    ],
  },
  {
    title: "Barra superior",
    items: [
      { key: "topbarBg",   label: "Fondo",        varName: "--topbar-bg" },
      { key: "topbarLine", label: "Línea inferior", varName: "--topbar-line" },
    ],
  },
  {
    title: "Puertas del armario",
    desc: "Las dos hojas metálicas que se abren al hacer click.",
    items: [
      { key: "door1", label: "Puerta arriba", varName: "--door-1" },
      { key: "door2", label: "Puerta medio",  varName: "--door-2" },
      { key: "door3", label: "Puerta abajo",  varName: "--door-3" },
      { key: "doorBorder", label: "Borde puerta", varName: "--door-border" },
      { key: "rivet1", label: "Remaches claro", varName: "--rivet-1" },
      { key: "rivet2", label: "Remaches oscuro", varName: "--rivet-2" },
      { key: "handle1", label: "Manilla claro", varName: "--handle-1" },
      { key: "handle2", label: "Manilla oscuro",varName: "--handle-2" },
    ],
  },
  {
    title: "Interior del armario",
    items: [
      { key: "interior1", label: "Interior arriba", varName: "--interior-1" },
      { key: "interior2", label: "Interior medio",  varName: "--interior-2" },
      { key: "interior3", label: "Interior abajo",  varName: "--interior-3" },
    ],
  },
  {
    title: "Estanterías (baldas)",
    items: [
      { key: "shelf1", label: "Balda arriba", varName: "--shelf-1" },
      { key: "shelf2", label: "Balda abajo",  varName: "--shelf-2" },
    ],
  },
  {
    title: "Cajitas de objetos",
    items: [
      { key: "item1",      label: "Caja arriba", varName: "--item-1" },
      { key: "item2",      label: "Caja abajo",  varName: "--item-2" },
      { key: "itemBorder", label: "Borde caja",  varName: "--item-border" },
      { key: "itemMeta1",  label: "Pie arriba",  varName: "--item-meta-1" },
      { key: "itemMeta2",  label: "Pie abajo",   varName: "--item-meta-2" },
    ],
  },
  {
    title: "Color de acento",
    desc: "Color destacado: marca, botones, códigos, hover.",
    items: [
      { key: "rust",     label: "Acento principal", varName: "--rust" },
      { key: "rust2",    label: "Acento hover",     varName: "--rust-2" },
      { key: "warning",  label: "Aviso (highlight)",varName: "--warning" },
    ],
  },
  {
    title: "Texto",
    items: [
      { key: "txt1", label: "Texto principal",  varName: "--txt-1" },
      { key: "txt2", label: "Texto secundario", varName: "--txt-2" },
      { key: "txt3", label: "Texto débil",      varName: "--txt-3" },
    ],
  },
  {
    title: "Modal de objeto",
    items: [
      { key: "modalBg1", label: "Fondo arriba", varName: "--modal-bg-1" },
      { key: "modalBg2", label: "Fondo abajo",  varName: "--modal-bg-2" },
    ],
  },
  {
    title: "Resaltado de búsqueda",
    desc: "Color del rectángulo neón que parpadea sobre el objeto buscado.",
    items: [
      { key: "neon", label: "Color neón", varName: "--neon" },
    ],
  },
];

const ALL_COLOR_KEYS = COLOR_GROUPS.flatMap(g => g.items.map(i => i.key));

const COLOR_DEFAULTS = {
  bgApp1: "#1a1d20", bgApp2: "#0a0b0c", bgApp3: "#050506", bg0: "#08090a",
  floor1: "#141618", floor2: "#08090a", wallLight: "#ffdcaa",
  topbarBg: "#0a0b0c", topbarLine: "#1a1d20",
  door1: "#2a2d31", door2: "#1f2226", door3: "#16181a",
  doorBorder: "#1a1d20", rivet1: "#6a6f76", rivet2: "#14171a",
  handle1: "#8a8f96", handle2: "#3a3e44",
  interior1: "#0a0b0c", interior2: "#0e1012", interior3: "#0c0d0f",
  shelf1: "#2a2d31", shelf2: "#1a1d20",
  item1: "#1c1e21", item2: "#131517", itemBorder: "#25282c",
  itemMeta1: "#1f2226", itemMeta2: "#14171a",
  rust: "#c2622b", rust2: "#d56e30", warning: "#d4a64a",
  txt1: "#e8e6e1", txt2: "#a8a59c", txt3: "#6a6862",
  modalBg1: "#14171a", modalBg2: "#0d0f11",
  neon: "#00ffd0",
};

const BUILTIN_PRESETS = {
  "Industrial (default)": COLOR_DEFAULTS,
  "Azul nocturno": {
    ...COLOR_DEFAULTS,
    bgApp1: "#1a2030", bgApp2: "#0a1020", bgApp3: "#050810", bg0: "#08101c",
    floor1: "#161e2e", floor2: "#080c18", wallLight: "#a8c8ff",
    topbarBg: "#0a1020", topbarLine: "#1a2030",
    door1: "#2a3550", door2: "#1f2940", door3: "#161e30",
    doorBorder: "#0a1020", rivet1: "#6a82a8", rivet2: "#14202c",
    handle1: "#8aa0c8", handle2: "#3a4a64",
    interior1: "#0a1020", interior2: "#0e1428", interior3: "#0c1224",
    shelf1: "#2a3550", shelf2: "#1a2030",
    item1: "#1e2535", item2: "#131826", itemBorder: "#252e42",
    itemMeta1: "#1f2940", itemMeta2: "#141a26",
    rust: "#4a90e2", rust2: "#6aa8ee",
    txt1: "#e8eef8", txt2: "#a8b0c5", txt3: "#6a7090",
    modalBg1: "#141a26", modalBg2: "#0d121c",
  },
  "Bosque": {
    ...COLOR_DEFAULTS,
    bgApp1: "#1a2820", bgApp2: "#0a1810", bgApp3: "#051008", bg0: "#08120a",
    floor1: "#141e16", floor2: "#08100a",
    topbarBg: "#0a1810", topbarLine: "#1a2820",
    door1: "#2a3a30", door2: "#1f2f25", door3: "#16201a",
    doorBorder: "#0a1810", rivet1: "#6a8870", rivet2: "#142016",
    handle1: "#8aaa90", handle2: "#3a503e",
    interior1: "#0a1810", interior2: "#0e1c14", interior3: "#0c1810",
    shelf1: "#2a3a30", shelf2: "#1a2820",
    item1: "#1c2520", item2: "#131a16", itemBorder: "#252e2a",
    itemMeta1: "#1f2f25", itemMeta2: "#141a16",
    rust: "#7ab85c", rust2: "#8fce72",
    txt1: "#e8f0e6", txt2: "#a8b8a0", txt3: "#6a7868",
  },
  "Rojo taller": {
    ...COLOR_DEFAULTS,
    bgApp1: "#2a1a1a", bgApp2: "#1a0a0a", bgApp3: "#100505", bg0: "#180808",
    floor1: "#1e1414", floor2: "#100808",
    topbarBg: "#1a0a0a", topbarLine: "#2a1a1a",
    door1: "#3a2a2a", door2: "#2a1f1f", door3: "#201616",
    doorBorder: "#1a0a0a", rivet1: "#886a6a", rivet2: "#201414",
    handle1: "#aa8a8a", handle2: "#503a3a",
    interior1: "#1a0a0a", interior2: "#1c0e0e", interior3: "#180c0c",
    shelf1: "#3a2a2a", shelf2: "#2a1a1a",
    item1: "#251c1c", item2: "#1a1313", itemBorder: "#2e2525",
    itemMeta1: "#2a1f1f", itemMeta2: "#1a1414",
    rust: "#e55a3c", rust2: "#f06b4d",
    txt1: "#f0e8e6", txt2: "#c8a8a0", txt3: "#886868",
  },
  "Claro": {
    ...COLOR_DEFAULTS,
    bgApp1: "#f0eeea", bgApp2: "#d8d6d0", bgApp3: "#b8b6b0", bg0: "#e8e6e1",
    floor1: "#c8c6c0", floor2: "#a8a59c", wallLight: "#fff6e0",
    topbarBg: "#e0deda", topbarLine: "#c0beba",
    door1: "#a8a59c", door2: "#888580", door3: "#686560",
    doorBorder: "#484540", rivet1: "#48453e", rivet2: "#28251e",
    handle1: "#28251e", handle2: "#0a0805",
    interior1: "#d8d6d0", interior2: "#c8c6c0", interior3: "#b8b6b0",
    shelf1: "#888580", shelf2: "#686560",
    item1: "#f0eeea", item2: "#d8d6d0", itemBorder: "#a8a59c",
    itemMeta1: "#c0beba", itemMeta2: "#a8a59c",
    rust: "#c2622b", rust2: "#a85220",
    txt1: "#1a1815", txt2: "#4a4845", txt3: "#7a7875",
    modalBg1: "#f0eeea", modalBg2: "#d8d6d0",
  },
  "Cyber neón": {
    ...COLOR_DEFAULTS,
    neon: "#ff00ff",
    bgApp1: "#1a0a2a", bgApp2: "#0a051a", bgApp3: "#050010", bg0: "#08051a",
    floor1: "#140a24", floor2: "#080414", wallLight: "#ff00ff",
    topbarBg: "#0a051a", topbarLine: "#1a0a2a",
    door1: "#2a1a4a", door2: "#1f1238", door3: "#160a28",
    doorBorder: "#0a051a", rivet1: "#9a6aff", rivet2: "#14082a",
    handle1: "#c8a0ff", handle2: "#5a3aaa",
    interior1: "#0a051a", interior2: "#0e0825", interior3: "#0c0420",
    shelf1: "#2a1a4a", shelf2: "#1a0a2a",
    item1: "#1e1235", item2: "#130828", itemBorder: "#352048",
    itemMeta1: "#1f1238", itemMeta2: "#140828",
    rust: "#00ffd4", rust2: "#5affe0",
    warning: "#ffea00",
    txt1: "#f0e8ff", txt2: "#b8a0e0", txt3: "#7860a0",
    modalBg1: "#140828", modalBg2: "#0a0418",
  },
  "Cobre & cuero": {
    ...COLOR_DEFAULTS,
    bgApp1: "#28201a", bgApp2: "#181210", bgApp3: "#0c0806", bg0: "#1a120e",
    floor1: "#1e1612", floor2: "#100a08", wallLight: "#f0c890",
    topbarBg: "#18120e", topbarLine: "#2a1f18",
    door1: "#3a2a1c", door2: "#28201a", door3: "#1c150f",
    doorBorder: "#0e0905", rivet1: "#c08a5a", rivet2: "#1c1208",
    handle1: "#daa672", handle2: "#5c402a",
    interior1: "#1a120c", interior2: "#1e1610", interior3: "#181008",
    shelf1: "#382a1f", shelf2: "#22180e",
    item1: "#26201a", item2: "#181210", itemBorder: "#3a2e22",
    itemMeta1: "#2a1f18", itemMeta2: "#181210",
    rust: "#d97a3c", rust2: "#e8924c",
    warning: "#e6b85a",
    txt1: "#f4e8d6", txt2: "#c8a880", txt3: "#7a6850",
    modalBg1: "#1e1610", modalBg2: "#100a08",
  },
  "Hospital / clean room": {
    ...COLOR_DEFAULTS,
    bgApp1: "#e8eef0", bgApp2: "#cfdadc", bgApp3: "#a8b8bc", bg0: "#dde6e8",
    floor1: "#bdcacc", floor2: "#9aa8aa", wallLight: "#ffffff",
    topbarBg: "#dee6e8", topbarLine: "#bcc8ca",
    door1: "#f4f8f9", door2: "#dce6e8", door3: "#bccacc",
    doorBorder: "#7a8a8c", rivet1: "#5a6a6c", rivet2: "#22302e",
    handle1: "#3a4a4c", handle2: "#1a2828",
    interior1: "#f0f4f5", interior2: "#dee6e8", interior3: "#cad6d8",
    shelf1: "#aebabc", shelf2: "#8a9a9c",
    item1: "#f8fafa", item2: "#dde6e8", itemBorder: "#a8b8ba",
    itemMeta1: "#cad6d8", itemMeta2: "#aebabc",
    rust: "#1aa8b8", rust2: "#16c0d2",
    warning: "#e8a52c",
    txt1: "#0c1a1c", txt2: "#3a5052", txt3: "#6a8082",
    modalBg1: "#f4f8f9", modalBg2: "#dde6e8",
  },
  "Vintage sepia": {
    ...COLOR_DEFAULTS,
    bgApp1: "#3a2a1c", bgApp2: "#241810", bgApp3: "#150c08", bg0: "#1c1208",
    floor1: "#221810", floor2: "#100a06", wallLight: "#e8c490",
    topbarBg: "#241810", topbarLine: "#3a2a1c",
    door1: "#4a3724", door2: "#382a1c", door3: "#241810",
    doorBorder: "#100a06", rivet1: "#a87a52", rivet2: "#22160c",
    handle1: "#c8a070", handle2: "#624628",
    interior1: "#241810", interior2: "#2a1e14", interior3: "#1e140a",
    shelf1: "#4a3724", shelf2: "#2e2218",
    item1: "#322318", item2: "#1e1410", itemBorder: "#4a3424",
    itemMeta1: "#382a1c", itemMeta2: "#1e1410",
    rust: "#c08a3a", rust2: "#d6a05a",
    warning: "#e6c460",
    txt1: "#f0d8a0", txt2: "#c8a070", txt3: "#7a5a3a",
    modalBg1: "#2a1e14", modalBg2: "#1a1008",
  },
  "Verde militar": {
    ...COLOR_DEFAULTS,
    bgApp1: "#2a2e22", bgApp2: "#181c12", bgApp3: "#0c1008", bg0: "#181c10",
    floor1: "#1e2218", floor2: "#101408", wallLight: "#cce088",
    topbarBg: "#181c12", topbarLine: "#2a2e22",
    door1: "#3a4028", door2: "#2a3020", door3: "#1e2218",
    doorBorder: "#0c1008", rivet1: "#7a8a4a", rivet2: "#1c200e",
    handle1: "#a0b06a", handle2: "#4a5428",
    interior1: "#181c10", interior2: "#1c2014", interior3: "#14180c",
    shelf1: "#3a4028", shelf2: "#22281a",
    item1: "#262a1c", item2: "#181c12", itemBorder: "#363c24",
    itemMeta1: "#2a3020", itemMeta2: "#181c12",
    rust: "#9aaa3c", rust2: "#aebc52",
    warning: "#e6c828",
    txt1: "#e8eed8", txt2: "#aab088", txt3: "#6a7050",
    modalBg1: "#1c2014", modalBg2: "#101408",
  },
  "Monocromo": {
    ...COLOR_DEFAULTS,
    bgApp1: "#1a1a1a", bgApp2: "#0a0a0a", bgApp3: "#000000", bg0: "#080808",
    floor1: "#141414", floor2: "#080808", wallLight: "#ffffff",
    topbarBg: "#0a0a0a", topbarLine: "#1f1f1f",
    door1: "#2a2a2a", door2: "#1f1f1f", door3: "#161616",
    doorBorder: "#0a0a0a", rivet1: "#888888", rivet2: "#141414",
    handle1: "#cccccc", handle2: "#3a3a3a",
    interior1: "#0a0a0a", interior2: "#0e0e0e", interior3: "#0c0c0c",
    shelf1: "#2a2a2a", shelf2: "#1a1a1a",
    item1: "#1e1e1e", item2: "#131313", itemBorder: "#2a2a2a",
    itemMeta1: "#1f1f1f", itemMeta2: "#141414",
    rust: "#ffffff", rust2: "#dddddd",
    warning: "#ffaa00",
    txt1: "#f5f5f5", txt2: "#aaaaaa", txt3: "#666666",
    modalBg1: "#141414", modalBg2: "#0a0a0a",
  },
  "Submarino": {
    ...COLOR_DEFAULTS,
    neon: "#5cf0ff",
    bgApp1: "#0a2028", bgApp2: "#051218", bgApp3: "#02080c", bg0: "#04181f",
    floor1: "#08181e", floor2: "#020a0e", wallLight: "#5acce0",
    topbarBg: "#051218", topbarLine: "#0e2832",
    door1: "#0e3848", door2: "#0a2a35", door3: "#061c24",
    doorBorder: "#02080c", rivet1: "#3a8aa0", rivet2: "#08181e",
    handle1: "#5cb0c8", handle2: "#1a4e60",
    interior1: "#051218", interior2: "#08202a", interior3: "#04161e",
    shelf1: "#0e3848", shelf2: "#082630",
    item1: "#0c2530", item2: "#061820", itemBorder: "#103040",
    itemMeta1: "#0a2a35", itemMeta2: "#06181e",
    rust: "#28c0d8", rust2: "#48d8ee",
    warning: "#ffce5a",
    txt1: "#cce8f0", txt2: "#88b8c8", txt3: "#506878",
    modalBg1: "#08202a", modalBg2: "#04101a",
  },
  "Lava volcánica": {
    ...COLOR_DEFAULTS,
    bgApp1: "#28100a", bgApp2: "#180806", bgApp3: "#0a0402", bg0: "#180a08",
    floor1: "#1c0c08", floor2: "#0c0604", wallLight: "#ffaa50",
    topbarBg: "#180806", topbarLine: "#28100a",
    door1: "#2a1410", door2: "#1c0c08", door3: "#100806",
    doorBorder: "#0a0402", rivet1: "#a04a28", rivet2: "#1a0a06",
    handle1: "#d06a3a", handle2: "#581c10",
    interior1: "#180806", interior2: "#1c0a08", interior3: "#140604",
    shelf1: "#2c1410", shelf2: "#1c0c08",
    item1: "#22100c", item2: "#160806", itemBorder: "#341a14",
    itemMeta1: "#1c0c08", itemMeta2: "#100604",
    rust: "#ff5018", rust2: "#ff7a3a",
    warning: "#ffce28",
    txt1: "#ffd8b8", txt2: "#e09060", txt3: "#a05828",
    modalBg1: "#1c0c08", modalBg2: "#0e0604",
  },
  "Pastel suave": {
    ...COLOR_DEFAULTS,
    bgApp1: "#f5e8e8", bgApp2: "#e8d4d4", bgApp3: "#c8b0b0", bg0: "#eedede",
    floor1: "#dec0c0", floor2: "#b89898", wallLight: "#fff0f0",
    topbarBg: "#eedede", topbarLine: "#d8c0c0",
    door1: "#e8b8c8", door2: "#d8a0b8", door3: "#c088a0",
    doorBorder: "#a06888", rivet1: "#9a5a78", rivet2: "#603a48",
    handle1: "#7a4860", handle2: "#3a1828",
    interior1: "#f5e8e8", interior2: "#ead8d8", interior3: "#dec0c0",
    shelf1: "#c894a8", shelf2: "#a87090",
    item1: "#fceaee", item2: "#eed4d8", itemBorder: "#d8a8b8",
    itemMeta1: "#dec0c8", itemMeta2: "#c8a0b0",
    rust: "#a83870", rust2: "#c84888",
    warning: "#d8a838",
    txt1: "#3a1828", txt2: "#7a4868", txt3: "#a878a0",
    modalBg1: "#fceaee", modalBg2: "#ead8d8",
  },
  "Salón japonés": {
    ...COLOR_DEFAULTS,
    bgApp1: "#1c1410", bgApp2: "#0e0a08", bgApp3: "#040302", bg0: "#0e0a08",
    floor1: "#181210", floor2: "#0a0806", wallLight: "#f4dca0",
    topbarBg: "#0e0a08", topbarLine: "#1c1410",
    door1: "#2a1f18", door2: "#1c1410", door3: "#100b08",
    doorBorder: "#040302", rivet1: "#806a4a", rivet2: "#1a1208",
    handle1: "#a08a68", handle2: "#4a3a28",
    interior1: "#100b08", interior2: "#181210", interior3: "#0c0806",
    shelf1: "#2a1f18", shelf2: "#181210",
    item1: "#1c1612", item2: "#0e0a08", itemBorder: "#2a2018",
    itemMeta1: "#181210", itemMeta2: "#0c0806",
    rust: "#c83a28", rust2: "#e04a38",
    warning: "#e8b85a",
    txt1: "#f4ead8", txt2: "#b89888", txt3: "#7a5a48",
    modalBg1: "#181210", modalBg2: "#0c0806",
  },
  "Ártico": {
    ...COLOR_DEFAULTS,
    bgApp1: "#dee8f0", bgApp2: "#c0cfdc", bgApp3: "#94a8b8", bg0: "#cdd8e2",
    floor1: "#a8b8c8", floor2: "#7c8c9c", wallLight: "#f0f8ff",
    topbarBg: "#cdd8e2", topbarLine: "#a8b8c8",
    door1: "#dcecf4", door2: "#bcd0dc", door3: "#94a8b8",
    doorBorder: "#5a6a78", rivet1: "#3a4858", rivet2: "#0a141e",
    handle1: "#1a2838", handle2: "#000810",
    interior1: "#e8f0f6", interior2: "#cad8e2", interior3: "#a8b8c8",
    shelf1: "#94a8b8", shelf2: "#6a7888",
    item1: "#f0f4f8", item2: "#cad8e2", itemBorder: "#94a8b8",
    itemMeta1: "#a8b8c8", itemMeta2: "#7c8c9c",
    rust: "#0a78a8", rust2: "#1a90c8",
    warning: "#dc7838",
    txt1: "#0a1828", txt2: "#3a4a5a", txt3: "#6a7a8a",
    modalBg1: "#e8f0f6", modalBg2: "#cad8e2",
  },
  "Terminal verde": {
    ...COLOR_DEFAULTS,
    neon: "#00ff66",
    bgApp1: "#000800", bgApp2: "#000400", bgApp3: "#000000", bg0: "#000400",
    floor1: "#001000", floor2: "#000400", wallLight: "#00ff00",
    topbarBg: "#000400", topbarLine: "#001800",
    door1: "#002800", door2: "#001800", door3: "#000c00",
    doorBorder: "#000400", rivet1: "#00aa00", rivet2: "#001000",
    handle1: "#00cc00", handle2: "#003c00",
    interior1: "#000400", interior2: "#001000", interior3: "#000800",
    shelf1: "#002800", shelf2: "#001800",
    item1: "#001800", item2: "#000800", itemBorder: "#002800",
    itemMeta1: "#001800", itemMeta2: "#000c00",
    rust: "#00ff00", rust2: "#44ff44",
    warning: "#ffff00",
    txt1: "#00ee00", txt2: "#00aa00", txt3: "#006600",
    modalBg1: "#001000", modalBg2: "#000400",
  },
  "Synthwave": {
    ...COLOR_DEFAULTS,
    neon: "#ff3ec8",
    bgApp1: "#1a0a3a", bgApp2: "#0a0420", bgApp3: "#050010", bg0: "#100628",
    floor1: "#1c0a40", floor2: "#080218", wallLight: "#ff66cc",
    topbarBg: "#0a0420", topbarLine: "#28104a",
    door1: "#3a1568", door2: "#28104a", door3: "#1a0a30",
    doorBorder: "#0a0420", rivet1: "#ff66cc", rivet2: "#28104a",
    handle1: "#ffaadd", handle2: "#80388a",
    interior1: "#0e0428", interior2: "#160838", interior3: "#0a0420",
    shelf1: "#3a1568", shelf2: "#1f0a40",
    item1: "#241048", item2: "#150830", itemBorder: "#481c70",
    itemMeta1: "#28104a", itemMeta2: "#150830",
    rust: "#ff2da8", rust2: "#ff5cc0",
    warning: "#ffd75c",
    txt1: "#f8e8ff", txt2: "#c890e8", txt3: "#7858a8",
    modalBg1: "#160838", modalBg2: "#0a0420",
  },
  "Café Moka": {
    ...COLOR_DEFAULTS,
    bgApp1: "#2a1d12", bgApp2: "#15100a", bgApp3: "#080604", bg0: "#1a120a",
    floor1: "#1e1610", floor2: "#0e0805", wallLight: "#e8c896",
    topbarBg: "#15100a", topbarLine: "#2a1d12",
    door1: "#3c2618", door2: "#2a1d12", door3: "#180f08",
    doorBorder: "#080604", rivet1: "#9a6a48", rivet2: "#1a0e08",
    handle1: "#c89878", handle2: "#5a3820",
    interior1: "#15100a", interior2: "#1c130c", interior3: "#100a06",
    shelf1: "#3c2618", shelf2: "#22180e",
    item1: "#241810", item2: "#160e08", itemBorder: "#3a2818",
    itemMeta1: "#2a1d12", itemMeta2: "#160e08",
    rust: "#b87644", rust2: "#d08e5c",
    warning: "#e8c068",
    txt1: "#f0e0c8", txt2: "#c8a888", txt3: "#7a5a40",
    modalBg1: "#1c130c", modalBg2: "#100a06",
  },
  "Lavanda": {
    ...COLOR_DEFAULTS,
    bgApp1: "#241830", bgApp2: "#15101e", bgApp3: "#08050e", bg0: "#180e22",
    floor1: "#1a1428", floor2: "#0a0612", wallLight: "#d8b8ff",
    topbarBg: "#15101e", topbarLine: "#241830",
    door1: "#382548", door2: "#241830", door3: "#180f20",
    doorBorder: "#08050e", rivet1: "#a888d0", rivet2: "#180f24",
    handle1: "#cbb0e8", handle2: "#5a3a78",
    interior1: "#15101e", interior2: "#1c1428", interior3: "#100a18",
    shelf1: "#382548", shelf2: "#241830",
    item1: "#241830", item2: "#150f20", itemBorder: "#382548",
    itemMeta1: "#281c38", itemMeta2: "#180f22",
    rust: "#b888e8", rust2: "#cba0f0",
    warning: "#e8c878",
    txt1: "#f0e0ff", txt2: "#c8a8e0", txt3: "#7860a0",
    modalBg1: "#1c1428", modalBg2: "#100a18",
  },
  "Solarized": {
    ...COLOR_DEFAULTS,
    bgApp1: "#073642", bgApp2: "#002b36", bgApp3: "#001b22", bg0: "#04323c",
    floor1: "#063038", floor2: "#001a20", wallLight: "#fdf6e3",
    topbarBg: "#002b36", topbarLine: "#073642",
    door1: "#0a4b56", door2: "#073642", door3: "#052830",
    doorBorder: "#001b22", rivet1: "#586e75", rivet2: "#001b22",
    handle1: "#93a1a1", handle2: "#586e75",
    interior1: "#002b36", interior2: "#073642", interior3: "#04323c",
    shelf1: "#0a4b56", shelf2: "#073642",
    item1: "#0a3a48", item2: "#052830", itemBorder: "#0e5868",
    itemMeta1: "#073642", itemMeta2: "#052830",
    rust: "#cb4b16", rust2: "#dc6b3c",
    warning: "#b58900",
    txt1: "#fdf6e3", txt2: "#93a1a1", txt3: "#657b83",
    modalBg1: "#073642", modalBg2: "#002b36",
  },
  "Cherry": {
    ...COLOR_DEFAULTS,
    bgApp1: "#2a0a18", bgApp2: "#180510", bgApp3: "#0a0008", bg0: "#180a14",
    floor1: "#1c0814", floor2: "#0a0208", wallLight: "#ff90b8",
    topbarBg: "#180510", topbarLine: "#2a0a18",
    door1: "#421426", door2: "#2a0a18", door3: "#180810",
    doorBorder: "#0a0008", rivet1: "#a8385c", rivet2: "#1c0a14",
    handle1: "#d05a80", handle2: "#5e1830",
    interior1: "#180510", interior2: "#1e0a18", interior3: "#10040a",
    shelf1: "#421426", shelf2: "#2a0e1a",
    item1: "#260a18", item2: "#160510", itemBorder: "#3a1426",
    itemMeta1: "#2a0a18", itemMeta2: "#160510",
    rust: "#e8285c", rust2: "#f24878",
    warning: "#ffc85a",
    txt1: "#ffe0ec", txt2: "#d090a8", txt3: "#8a5870",
    modalBg1: "#1e0a18", modalBg2: "#100410",
  },
  "Bauhaus": {
    ...COLOR_DEFAULTS,
    bgApp1: "#f4e8d0", bgApp2: "#e0d4ba", bgApp3: "#a89c84", bg0: "#eadcc0",
    floor1: "#cab8a0", floor2: "#998870", wallLight: "#fff8e8",
    topbarBg: "#eadcc0", topbarLine: "#cab8a0",
    door1: "#1c1c1c", door2: "#0a0a0a", door3: "#000000",
    doorBorder: "#000000", rivet1: "#c83828", rivet2: "#000000",
    handle1: "#ffd400", handle2: "#3a2a00",
    interior1: "#f4e8d0", interior2: "#e0d4ba", interior3: "#cab8a0",
    shelf1: "#1c1c1c", shelf2: "#0a0a0a",
    item1: "#fff8e8", item2: "#e0d4ba", itemBorder: "#1c1c1c",
    itemMeta1: "#cab8a0", itemMeta2: "#a89c84",
    rust: "#0058c8", rust2: "#1a78e8",
    warning: "#c83828",
    txt1: "#000000", txt2: "#3a3a3a", txt3: "#7a7a7a",
    modalBg1: "#fff8e8", modalBg2: "#e0d4ba",
  },
  "Mint": {
    ...COLOR_DEFAULTS,
    bgApp1: "#e8f4ee", bgApp2: "#cae0d2", bgApp3: "#9ab8a8", bg0: "#dceee2",
    floor1: "#b8d4c4", floor2: "#88a898", wallLight: "#f0fff5",
    topbarBg: "#dceee2", topbarLine: "#b8d4c4",
    door1: "#88c8a8", door2: "#68b088", door3: "#509070",
    doorBorder: "#306848", rivet1: "#1a4830", rivet2: "#0a2818",
    handle1: "#1a4830", handle2: "#000a04",
    interior1: "#f0f8f4", interior2: "#dceee2", interior3: "#c8e0d0",
    shelf1: "#509070", shelf2: "#386850",
    item1: "#f8fdfa", item2: "#dceee2", itemBorder: "#88c8a8",
    itemMeta1: "#c8e0d0", itemMeta2: "#a8c8b8",
    rust: "#00a868", rust2: "#1ac080",
    warning: "#e8a838",
    txt1: "#0a2818", txt2: "#306848", txt3: "#588870",
    modalBg1: "#f0f8f4", modalBg2: "#dceee2",
  },
};

function loadCustomThemes() {
  try {
    return JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || "{}");
  } catch (e) { return {}; }
}
function saveCustomThemes(themes) {
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themes));
}

function ThemeEditor({ open, onClose, colors, setColors }) {
  const [customThemes, setCustomThemes] = React.useState(loadCustomThemes);
  const [newName, setNewName] = React.useState("");

  if (!open) return null;

  const c = colors || COLOR_DEFAULTS;
  const setOne = (key, value) => setColors({ ...c, [key]: value });

  const applyPreset = (preset) => setColors({ ...COLOR_DEFAULTS, ...preset });

  const saveCurrent = () => {
    const name = newName.trim();
    if (!name) return;
    const next = { ...customThemes, [name]: { ...c } };
    setCustomThemes(next);
    saveCustomThemes(next);
    setNewName("");
  };
  const deleteCustom = (name) => {
    const next = { ...customThemes };
    delete next[name];
    setCustomThemes(next);
    saveCustomThemes(next);
  };

  return (
    <div className="theme-editor-backdrop" onClick={onClose}>
      <div className="theme-editor" onClick={(e) => e.stopPropagation()}>
        <div className="theme-editor-header">
          <div>
            <div className="theme-editor-title">Editor de tema</div>
            <div className="theme-editor-sub">Cambia cualquier color · los cambios se aplican en vivo</div>
          </div>
          <button className="theme-editor-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="theme-editor-body">
          {/* PRESETS RAIL */}
          <aside className="theme-editor-rail">
            <div className="rail-section-title">Presets integrados</div>
            <div className="rail-presets">
              {Object.entries(BUILTIN_PRESETS).map(([name, preset]) => (
                <PresetCard
                  key={name}
                  name={name}
                  preset={preset}
                  onClick={() => applyPreset(preset)}
                />
              ))}
            </div>

            <div className="rail-section-title">Mis temas</div>
            {Object.keys(customThemes).length === 0 && (
              <div className="rail-empty">Aún no has guardado ninguno.</div>
            )}
            <div className="rail-presets">
              {Object.entries(customThemes).map(([name, preset]) => (
                <PresetCard
                  key={name}
                  name={name}
                  preset={preset}
                  removable
                  onClick={() => applyPreset(preset)}
                  onRemove={() => deleteCustom(name)}
                />
              ))}
            </div>

            <div className="rail-save">
              <input
                className="rail-input"
                placeholder="Nombre del tema..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveCurrent(); }}
              />
              <button className="rail-save-btn" onClick={saveCurrent} disabled={!newName.trim()}>
                Guardar como nuevo
              </button>
            </div>

            <button className="rail-reset" onClick={() => applyPreset(COLOR_DEFAULTS)}>
              Restaurar por defecto
            </button>
          </aside>

          {/* COLOR GROUPS */}
          <div className="theme-editor-main">
            {COLOR_GROUPS.map((group) => (
              <div key={group.title} className="te-group">
                <div className="te-group-head">
                  <h3 className="te-group-title">{group.title}</h3>
                  {group.desc && <p className="te-group-desc">{group.desc}</p>}
                </div>
                <div className="te-group-grid">
                  {group.items.map((it) => (
                    <ColorRow
                      key={it.key}
                      label={it.label}
                      value={c[it.key] || COLOR_DEFAULTS[it.key]}
                      onChange={(v) => setOne(it.key, v)}
                      onReset={() => setOne(it.key, COLOR_DEFAULTS[it.key])}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetCard({ name, preset, onClick, removable, onRemove }) {
  return (
    <div className="preset-card" onClick={onClick}>
      <div className="preset-swatches">
        <span style={{ background: preset.bgApp1 }} />
        <span style={{ background: preset.door1 }} />
        <span style={{ background: preset.shelf1 }} />
        <span style={{ background: preset.rust }} />
        <span style={{ background: preset.txt1 }} />
      </div>
      <div className="preset-name">{name}</div>
      {removable && (
        <button
          className="preset-remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label="Eliminar tema"
        >✕</button>
      )}
    </div>
  );
}

function ColorRow({ label, value, onChange, onReset }) {
  const inputRef = React.useRef(null);
  return (
    <div className="color-row">
      <button
        type="button"
        className="color-row-swatch"
        style={{ background: value }}
        onClick={() => inputRef.current?.click()}
        aria-label={label}
      >
        <input
          ref={inputRef}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </button>
      <div className="color-row-meta">
        <div className="color-row-label">{label}</div>
        <input
          type="text"
          className="color-row-hex"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
          }}
        />
      </div>
      <button
        type="button"
        className="color-row-reset"
        onClick={onReset}
        title="Restaurar por defecto"
      >↺</button>
    </div>
  );
}

Object.assign(window, {
  ThemeEditor, COLOR_DEFAULTS, COLOR_GROUPS, ALL_COLOR_KEYS, BUILTIN_PRESETS,
});
