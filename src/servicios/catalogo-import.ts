import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { TipoItem, TIPO_ITEM_VALUES } from './enums/tipo-item.enum';

export const CATALOGO_IMPORT_MAX_ROWS = 500;
export const CATALOGO_IMPORT_MAX_BYTES = 2_000_000;
export const CATALOGO_IMPORT_COLUMNS = [
  'tipo',
  'nombre',
  'codigo',
  'categoria',
  'precio',
  'descripcion',
  'activo',
] as const;

const REQUIRED_HEADERS = ['tipo', 'nombre', 'categoria', 'precio'] as const;

export type CatalogoImportErrorRow = {
  row: number;
  tipo: string;
  nombre: string;
  codigo: string;
  categoria: string;
  precio: string;
  descripcion: string;
  activo: string;
  error: string;
};

export type CatalogoImportRawRow = {
  excelRow: number;
  empty: boolean;
  tipo: string;
  nombre: string;
  codigo: string;
  categoria: string;
  precio: string;
  descripcion: string;
  activo: string;
};

export type CatalogoImportValidated = {
  excelRow: number;
  raw: CatalogoImportRawRow;
  tipo: TipoItem;
  nombre: string;
  codigo?: string;
  categoriaCodigo: string;
  precioUnitario: number;
  descripcion?: string;
  activo: boolean;
};

export function assertCatalogoImportFile(file: {
  originalname?: string;
  size?: number;
  buffer?: Buffer;
}): void {
  const name = (file.originalname || '').toLowerCase();
  if (!name.endsWith('.xlsx')) {
    throw new BadRequestException('Solo se aceptan archivos .xlsx');
  }
  const size = file.size ?? file.buffer?.length ?? 0;
  if (size > CATALOGO_IMPORT_MAX_BYTES) {
    throw new BadRequestException('El archivo no puede superar 2MB');
  }
  if (!file.buffer?.length) {
    throw new BadRequestException('Debe adjuntar un archivo .xlsx');
  }
}

function cellToString(input: unknown): string {
  if (input && typeof input === 'object' && 'text' in input) {
    const displayed = String((input as { text?: unknown }).text ?? '').trim();
    if (displayed) return displayed;
  }
  const value =
    input && typeof input === 'object' && 'value' in input
      ? (input as { value: unknown }).value
      : input;
  if (value == null || value === '') return '';
  if (value instanceof Date) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object' && value !== null) {
    const rec = value as {
      text?: unknown;
      result?: unknown;
      richText?: { text?: string }[];
    };
    if (typeof rec.text === 'string') return rec.text.trim();
    if (Array.isArray(rec.richText)) {
      return rec.richText
        .map((p) => p.text ?? '')
        .join('')
        .trim();
    }
    if (rec.result !== undefined) return cellToString(rec.result);
    return '';
  }
  return String(value).trim();
}

/** Entero, o un solo decimal (`.` o `,` con 1–2 dígitos). Rechaza miles tipo 1,500. */
export function parsePrecioCell(raw: string): number | { error: string } {
  const t = raw.trim().replace(/\s/g, '');
  if (!t) return { error: 'precio debe ser un número' };
  if (/[eE]/.test(t) || t.includes('+') || t.includes('-')) {
    return { error: 'precio debe ser un número' };
  }
  const hasDot = t.includes('.');
  const hasComma = t.includes(',');
  if (hasDot && hasComma) {
    return { error: 'precio: usa solo punto o coma decimal, sin miles' };
  }
  let normalized = t;
  if (hasComma) {
    const parts = t.split(',');
    if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1])) {
      return { error: 'precio: usa coma solo como decimal (ej. 1500,50)' };
    }
    normalized = `${parts[0]}.${parts[1]}`;
  } else if (hasDot) {
    const parts = t.split('.');
    if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1])) {
      return { error: 'precio: usa punto decimal con 1 o 2 decimales, o entero' };
    }
  } else if (!/^\d+$/.test(t)) {
    return { error: 'precio debe ser un número' };
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return { error: 'precio debe ser un número' };
  return n;
}

function excelSafeCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function normalizeHeader(value: unknown): string {
  return cellToString(value).toLowerCase();
}

export function parseActivoCell(raw: string): boolean | null {
  const t = raw.trim().toLowerCase();
  if (
    t === '' ||
    t === 'true' ||
    t === 'si' ||
    t === 'sí' ||
    t === '1' ||
    t === 'yes' ||
    t === 'activo'
  ) {
    return true;
  }
  if (t === 'false' || t === 'no' || t === '0' || t === 'inactivo') {
    return false;
  }
  return null;
}

export function validateCatalogoImportRow(
  raw: CatalogoImportRawRow,
): CatalogoImportValidated | { error: string } {
  const tipoNorm = raw.tipo.trim().toLowerCase();
  if (!TIPO_ITEM_VALUES.includes(tipoNorm as TipoItem)) {
    return { error: 'tipo debe ser servicio o producto' };
  }
  const nombre = raw.nombre.trim().normalize('NFC');
  if (!nombre) {
    return { error: 'Debe proporcionar el nombre del servicio' };
  }
  if (nombre.length > 200) {
    return { error: 'nombre no puede superar 200 caracteres' };
  }
  const codigo = raw.codigo.trim();
  if (codigo.length > 64) {
    return { error: 'codigo no puede superar 64 caracteres' };
  }
  const categoriaCodigo = raw.categoria.trim().toUpperCase();
  if (!categoriaCodigo) {
    return { error: 'categoria es obligatoria' };
  }
  const parsedPrecio = parsePrecioCell(raw.precio);
  if (typeof parsedPrecio !== 'number') {
    return parsedPrecio;
  }
  const precioUnitario = parsedPrecio;
  const descripcion = raw.descripcion.trim();
  if (descripcion.length > 2000) {
    return { error: 'descripcion no puede superar 2000 caracteres' };
  }
  const activo = parseActivoCell(raw.activo);
  if (activo === null) {
    return { error: 'activo debe ser si, no, true o false' };
  }
  return {
    excelRow: raw.excelRow,
    raw,
    tipo: tipoNorm as TipoItem,
    nombre,
    ...(codigo ? { codigo } : {}),
    categoriaCodigo,
    precioUnitario,
    ...(descripcion ? { descripcion } : {}),
    activo,
  };
}

export function toImportErrorRow(
  raw: CatalogoImportRawRow,
  error: string,
): CatalogoImportErrorRow {
  return {
    row: raw.excelRow,
    tipo: raw.tipo,
    nombre: raw.nombre,
    codigo: raw.codigo,
    categoria: raw.categoria,
    precio: raw.precio,
    descripcion: raw.descripcion,
    activo: raw.activo,
    error,
  };
}

export async function buildCatalogoImportPlantilla(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const inst = wb.addWorksheet('Instrucciones');
  inst.getColumn(1).width = 22;
  inst.getColumn(2).width = 72;
  inst.addRow(['Carga masiva de productos y servicios']);
  inst.addRow([]);
  inst.addRow(['Use la hoja Datos. No cambie los nombres de las columnas.']);
  inst.addRow(['Máximo 500 filas y 2 MB. Solo archivos .xlsx. Sin imágenes.']);
  inst.addRow([]);
  inst.addRow(['Columna', 'Regla']);
  inst.addRow(['tipo', 'Obligatorio: servicio o producto']);
  inst.addRow(['nombre', 'Obligatorio. Único en el tenant (mayúsculas no importan)']);
  inst.addRow(['codigo', 'Opcional. Si se indica, único en el tenant']);
  inst.addRow(['categoria', 'Obligatorio. Código de una categoría activa (ej. MED)']);
  inst.addRow(['precio', 'Obligatorio. ≥ 0 MXN. Entero o decimal (1500 o 1500,50). Sin miles']);
  inst.addRow(['descripcion', 'Opcional']);
  inst.addRow(['activo', 'Opcional. si/no (vacío = sí)']);
  inst.addRow([]);
  inst.addRow([
    'Las filas válidas se registran aunque otras fallen. El reporte trae solo los fallos para corregir y volver a subir.',
  ]);

  const datos = wb.addWorksheet('Datos');
  datos.addRow([...CATALOGO_IMPORT_COLUMNS]);
  datos.addRow([
    'servicio',
    'Consulta general',
    'CONS-001',
    'MED',
    500,
    'Ejemplo de servicio. Reemplace el código de categoría por uno de su catálogo.',
    'si',
  ]);
  datos.addRow([
    'producto',
    'Kit de curación',
    'KIT-001',
    'MED',
    150,
    '',
    'si',
  ]);
  CATALOGO_IMPORT_COLUMNS.forEach((_, i) => {
    datos.getColumn(i + 1).width = i === 1 || i === 5 ? 28 : 14;
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function parseCatalogoImportBuffer(
  buffer: Buffer,
): Promise<CatalogoImportRawRow[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException('No se pudo leer el archivo Excel');
  }

  const sheet =
    wb.getWorksheet('Datos') ??
    wb.worksheets.find((s) => s.name.trim().toLowerCase() === 'datos') ??
    wb.worksheets[0];
  if (!sheet) {
    throw new BadRequestException('No se pudo leer el archivo Excel');
  }

  const headerRow = sheet.getRow(1);
  const headerIndex = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = normalizeHeader(cell);
    if (!key) return;
    if (headerIndex.has(key)) {
      throw new BadRequestException(`Columna duplicada: ${key}`);
    }
    headerIndex.set(key, colNumber);
  });

  const missing = REQUIRED_HEADERS.filter((h) => !headerIndex.has(h));
  if (missing.length) {
    throw new BadRequestException(
      `Faltan columnas obligatorias: ${missing.join(', ')}`,
    );
  }

  const rows: CatalogoImportRawRow[] = [];
  let dataRows = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const read = (col: (typeof CATALOGO_IMPORT_COLUMNS)[number]) => {
      const idx = headerIndex.get(col);
      if (!idx) return '';
      return cellToString(row.getCell(idx));
    };
    const raw: CatalogoImportRawRow = {
      excelRow: rowNumber,
      empty: false,
      tipo: read('tipo'),
      nombre: read('nombre'),
      codigo: read('codigo'),
      categoria: read('categoria'),
      precio: read('precio'),
      descripcion: read('descripcion'),
      activo: read('activo'),
    };
    raw.empty = !(
      raw.tipo ||
      raw.nombre ||
      raw.codigo ||
      raw.categoria ||
      raw.precio ||
      raw.descripcion ||
      raw.activo
    );
    if (!raw.empty) {
      dataRows += 1;
      if (dataRows > CATALOGO_IMPORT_MAX_ROWS) {
        throw new BadRequestException(
          `El archivo no puede tener más de ${CATALOGO_IMPORT_MAX_ROWS} filas`,
        );
      }
    }
    rows.push(raw);
  });

  return rows;
}

export async function buildCatalogoImportReporte(
  errors: CatalogoImportErrorRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Datos');
  sheet.addRow([...CATALOGO_IMPORT_COLUMNS, 'error']);
  for (const err of errors) {
    sheet.addRow([
      excelSafeCell(err.tipo),
      excelSafeCell(err.nombre),
      excelSafeCell(err.codigo),
      excelSafeCell(err.categoria),
      excelSafeCell(err.precio),
      excelSafeCell(err.descripcion),
      excelSafeCell(err.activo),
      excelSafeCell(err.error),
    ]);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
