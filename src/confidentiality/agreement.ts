/** Versión vigente. Bump = re-aceptación. */
export const CURRENT_AGREEMENT_VERSION = 'v2';

export const CONFIDENTIALITY_AGREEMENT_REQUIRED =
  'CONFIDENTIALITY_AGREEMENT_REQUIRED';

export type AgreementSection = {
  title: string;
  body: string;
};

export const CURRENT_AGREEMENT_INTRO =
  'Al acceder y utilizar Aestimare, el usuario reconoce, acepta y se compromete a lo siguiente:';

export const CURRENT_AGREEMENT_SECTIONS: AgreementSection[] = [
  {
    title: '1. Manejo de Información Confidencial y Comercial:',
    body: 'Reconozco que en el desempeño de mis funciones tendré acceso a información confidencial de la organización usuaria y de sus clientes, incluyendo datos personales de contacto, información comercial, condiciones y montos de cotizaciones, catálogos de servicios y configuración de la organización. Entiendo que esta información se encuentra protegida por la Ley Federal de Protección de Datos Personales en Posesión de los Particulares, la normatividad aplicable, y las políticas internas de la organización.',
  },
  {
    title: '2. Seguridad de Credenciales:',
    body: 'Me comprometo a mantener la confidencialidad de mis credenciales de acceso (usuario y contraseña). Entiendo que mi cuenta es personal e intransferible, por lo que asumo la responsabilidad total de cualquier actividad, registro o modificación que se realice bajo mi perfil de usuario.',
  },
  {
    title: '3. Prohibición de Divulgación:',
    body: 'Queda estrictamente prohibido capturar, exportar, copiar, imprimir o transmitir por cualquier medio (físico, electrónico o mensajería de terceros) la información de clientes, cotizaciones, catálogos de servicios o configuraciones de la plataforma para fines ajenos y no autorizados a mi labor dentro de la organización.',
  },
  {
    title: '4. Trazabilidad y Consecuencias:',
    body: 'Acepto que determinadas actividades relevantes realizadas dentro de la plataforma son registradas mediante mecanismos de auditoría, conforme a los eventos definidos para el producto. Comprendo que la violación a este acuerdo facultará al titular o administrador del sistema  a revocar mi acceso de forma inmediata y definitiva, independientemente de las sanciones civiles, penales o administrativas a las que haya lugar por la vulneración de la confidencialidad de la información de la organización usuaria y de sus clientes.',
  },
];

export const CURRENT_AGREEMENT_DECLARATION =
  'Al hacer clic en "Acepto", confirmo que he leído y comprendido los términos de este acuerdo y manifiesto expresamente mi aceptación por medios electrónicos.';

export const CURRENT_AGREEMENT_FOOTER =
  'He leído y comprendo el Acuerdo de Confidencialidad y Uso de la Información';

/** Snapshot literal persistido en cada aceptación. */
export const CURRENT_AGREEMENT_TEXT = [
  CURRENT_AGREEMENT_INTRO,
  ...CURRENT_AGREEMENT_SECTIONS.map((s) => `${s.title}\n${s.body}`),
  CURRENT_AGREEMENT_DECLARATION,
].join('\n\n');
