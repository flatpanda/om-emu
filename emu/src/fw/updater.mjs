// The vendor's updater API, as tools/omfw_download.sh asks it: a firmware demand for a body's hardware code
// (OLY<code>000000000) answered with an XML reply that names the .BIN (file_name, file_size, url, model_name, up_date).
// It serves only each body's latest release (BLOBS.md). Pure: only fetch.
export const UPDATER_API = 'https://fw01.om-digitalsolutions.net/ww_inform/fcache.do';

// A field of the reply, or undefined
export const replyTag = (reply, k) => new RegExp(`<${k}>([^<]*)</${k}>`).exec(reply)?.[1];

// The reply for a code ('E143'), or null when the API serves no firmware for it
export async function ask(code) {
  const now = new Date(), p = (n) => String(n).padStart(2, '0');
  const time = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const body = `<?xml version="1.0"?>
<firmware_demand><revision>0001</revision><mac_address>00-00-00-00-80-D6</mac_address>
<time>${time}</time><language>ENU</language><application>FWUT</application>
<type>0000</type><version>00005000</version><os>WIN</os><country_code>0001</country_code>
<hardwares><firmup_mode>0</firmup_mode><hardware_info>
<hard_code>OLY${code}000000000</hard_code><firmware_version>00001000</firmware_version>
<serial_no>V5PF30000</serial_no><default_languages><code>ENU</code></default_languages>
</hardware_info></hardwares></firmware_demand>
`;
  const r = await fetch(UPDATER_API, { method: 'POST', body, headers: { 'User-Agent': 'Olympus', 'Content-Type': 'text/xml; Charset=UTF-8' } });
  const reply = await r.text();
  return replyTag(reply, 'file_name') ? reply : null;
}
