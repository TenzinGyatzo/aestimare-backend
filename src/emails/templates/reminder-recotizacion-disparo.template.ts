/**
 * Template HTML — aviso interno de recordatorio disparado (Story 10.1 / AD-33).
 * Los valores deben llegar ya escapados para HTML.
 */
export function reminderRecotizacionDisparoTemplate(params: {
  folio: string;
  dashboardUrl: string;
}): string {
  const { folio, dashboardUrl } = params;
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recordatorio de recotización · ${folio}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding: 24px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; padding: 28px;">
          <tr>
            <td>
              <h2 style="margin: 0 0 16px; color: #111827; font-size: 20px;">Es momento de recotizar</h2>
              <p style="margin: 0 0 12px; color: #374151; font-size: 15px; line-height: 1.5;">
                La cotización <strong>${folio}</strong> llegó a la fecha que programaste para volver a cotizar.
              </p>
              <p style="margin: 0 0 12px; color: #374151; font-size: 15px; line-height: 1.5;">
                Contacta al cliente y ofrécele una nueva cotización fuera del panel cuando corresponda.
              </p>
              <p style="margin: 16px 0 0;">
                <a href="${dashboardUrl}" style="color: #2563eb; font-size: 15px; text-decoration: underline;">Ver pendientes de recotizar</a>
              </p>
              <p style="margin: 16px 0 0; color: #6b7280; font-size: 13px;">
                Este aviso es interno. No requiere acción del cliente.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}
