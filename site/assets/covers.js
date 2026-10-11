// The demo's album and show covers: parodies, drawn here (nothing is copied). Each one nods to a well-known
// record or series by its look and a near name, and plays on the house: uptime, firmware, sensors, Wi-Fi.
// house.js turns each into an image: SavvyDemo.COVERS[album] is the inside of a 400×400 SVG.
(() => {
  const SANS = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
  const SERIF = "Georgia,Times New Roman,serif";
  const MONO = "Courier New,Courier,monospace";
  const t = (x, y, size, fill, text, more = "") =>
    `<text x='${x}' y='${y}' font-family='${SANS}' font-size='${size}' fill='${fill}' ${more}>${text}</text>`;
  const AIRPLANE_OFF = "M20.84 22.73L18 19.9L17.38 20.53L16 17.89L12.35 14.24L9.6 17L9.96 19.47L8.89 20.53L7.13 17.35L3.94 15.58L5 14.5L7.5 14.87L10.23 12.12L6.59 8.5L3.94 7.09L4.57 6.46L1.11 3L2.39 1.73L22.11 21.46L20.84 22.73M16.67 9.92L20.56 6.03C21.15 5.45 21.15 4.5 20.56 3.91S19 3.33 18.44 3.91L14.55 7.8L9.94 6.74L17.74 14.54L16.67 9.92Z";

  const COVERS = {
    // ---- jazz in the kitchen
    "Kinda Blue": `<defs><radialGradient id='a' cx='.68' cy='.38' r='.75'><stop offset='0' stop-color='#4b82c6'/><stop offset='1' stop-color='#071630'/></radialGradient></defs>
<rect width='400' height='400' fill='url(#a)'/>
<path d='M178 400c4-92 50-138 112-138s96 52 100 138z' fill='#061224' fill-opacity='.9'/>
<circle cx='268' cy='196' r='46' fill='#061224' fill-opacity='.9'/>
<path d='M236 214 118 246l-10-14-14 40 18-8 128-28z' fill='#cfe0f5' fill-opacity='.75'/>
<path d='M252 214q12 12 26 0' stroke='#4b82c6' stroke-width='4' fill='none' stroke-linecap='round'/>
${t(28, 62, 36, "#fff", "SMILES DAVIS", "font-weight='800' letter-spacing='1'")}
${t(30, 94, 24, "#bcd3f0", "kinda blue", "font-style='italic'")}`,

    "Time In": `<rect width='400' height='400' fill='#efe6d2'/>
<circle cx='112' cy='272' r='92' fill='#d9472b'/>
<ellipse cx='292' cy='170' rx='84' ry='58' fill='#f2a33a'/>
<path d='M30 160c60-40 120-20 150 30-50-20-100-20-150-30z' fill='#2a1a12'/>
<rect x='222' y='252' width='92' height='96' rx='14' fill='#2a1a12'/>
<path d='M314 272c34 0 34 52 0 52' stroke='#2a1a12' stroke-width='12' fill='none'/>
<path d='M246 236c-10-14 10-22 0-38M270 236c-10-14 10-22 0-38M294 236c-10-14 10-22 0-38' stroke='#2a1a12' stroke-width='5' fill='none' stroke-linecap='round'/>
${t(28, 66, 50, "#1a1410", "TIME IN", "font-weight='900' letter-spacing='-1'")}
${t(30, 94, 16, "#1a1410", "the dave brewbeck quartet", "letter-spacing='1'")}`,

    "Giant Stairs": `<rect width='400' height='400' fill='#e8b43a'/>
<path d='M0 400V344h80v-56h80v-56h80v-56h80v-56h80V400z' fill='#1e1a14'/>
<circle cx='356' cy='86' r='10' fill='#1e1a14'/><path d='M356 96v34M356 108l-12 14M356 108l12 10M356 130l-10 18M356 130l8 18' stroke='#1e1a14' stroke-width='5' stroke-linecap='round'/>
${t(26, 74, 62, "#c0392b", "GIANT", "font-weight='900' letter-spacing='-2'")}
${t(26, 132, 62, "#c0392b", "STAIRS", "font-weight='900' letter-spacing='-2'")}
${t(28, 164, 17, "#1e1a14", "JOAN COLDTRAIN", "font-weight='700' letter-spacing='4'")}`,

    "Waltz for Debbie": `<rect width='400' height='400' fill='#21183a'/>
<circle cx='212' cy='236' r='128' fill='#7b5ea7'/>
<path d='M226 132c-44 0-68 32-66 66 1 15-11 24-11 32 0 7 11 7 13 13-2 9 4 13 9 17-4 11 6 17 19 15l5 44h84c-7-33 4-66 13-98 11-44-15-89-66-89z' fill='#d8cbef'/>
<circle cx='268' cy='138' r='26' fill='#d8cbef'/>
<text x='28' y='58' font-family='${SERIF}' font-size='34' font-style='italic' fill='#fff'>waltz for debbie</text>
${t(30, 86, 14, "#c9b8e8", "BILL EVENS TRIO", "letter-spacing='3'")}`,

    // ---- ambient in the bedroom
    "Apollo 404": `<rect width='400' height='400' fill='#03060c'/>
<g fill='#fff'><circle cx='60' cy='150' r='1.6'/><circle cx='140' cy='200' r='1.2'/><circle cx='360' cy='60' r='1.4'/><circle cx='220' cy='130' r='1'/><circle cx='330' cy='210' r='1.3'/><circle cx='90' cy='240' r='1'/><circle cx='260' cy='40' r='1.2'/></g>
<circle cx='200' cy='600' r='330' fill='#26344a'/><circle cx='200' cy='600' r='330' fill='none' stroke='#5b7db1' stroke-opacity='.5' stroke-width='3'/>
<circle cx='312' cy='150' r='26' fill='#5b7db1'/><path d='M312 124a26 26 0 0 1 0 52a18 26 0 0 0 0-52z' fill='#03060c' fill-opacity='.65'/>
${t(28, 62, 30, "#e6ecf5", "APOLLO 404", "font-weight='300' letter-spacing='9'")}
${t(30, 92, 16, "#8fa6c8", "brian ego · moon not found", "letter-spacing='1'")}`,

    "Ambient 1: Music for Airplane Mode": `<rect width='400' height='400' fill='#dcd6c8'/>
<g stroke='#7d7a70' stroke-width='3' fill='none'>
<path d='M0 150h400' stroke-dasharray='40 14'/><path d='M0 196h400' stroke-dasharray='8 10'/><path d='M0 244h400' stroke-dasharray='70 20 10 20'/>
<path d='M0 292h400' stroke-dasharray='4 16'/><path d='M0 340h400' stroke-dasharray='120 30'/></g>
<g transform='translate(236 196) scale(5.2)'><path d='${AIRPLANE_OFF}' fill='#4a4740'/></g>
${t(28, 52, 16, "#4a4740", "ambient 1", "letter-spacing='3'")}
${t(28, 82, 24, "#2e2c27", "music for airplane mode", "font-weight='600'")}
${t(28, 106, 14, "#4a4740", "brian ego", "letter-spacing='2'")}`,

    "Spacebar": `<rect width='400' height='400' fill='#162024'/>
<rect x='44' y='212' width='312' height='92' rx='20' fill='#0c1214'/>
<rect x='44' y='200' width='312' height='88' rx='20' fill='#2f3e46' stroke='#84a98c' stroke-width='3'/>
<rect x='60' y='212' width='280' height='60' rx='14' fill='#3a4b54'/>
${t(28, 66, 40, "#d8e6dc", "SPACEBAR", "font-weight='800' letter-spacing='6'")}
${t(30, 96, 16, "#84a98c", "nils fram", "letter-spacing='3'")}`,

    "The Blue Notifications": `<rect width='400' height='400' fill='#2b4c7e'/>
<rect x='96' y='128' width='216' height='240' rx='10' fill='#0f2444'/>
<rect x='96' y='128' width='22' height='240' rx='6' fill='#0a1a33'/>
<rect x='146' y='188' width='136' height='54' rx='6' fill='#e9f0fa'/>
<text x='214' y='212' text-anchor='middle' font-family='${SERIF}' font-size='15' fill='#1b2f52'>the blue</text>
<text x='214' y='232' text-anchor='middle' font-family='${SERIF}' font-size='15' fill='#1b2f52'>notifications</text>
<circle cx='306' cy='130' r='32' fill='#e63946'/>${t(306, 139, 24, "#fff", "99+", "font-weight='800' text-anchor='middle'")}
${t(28, 62, 32, "#e9f0fa", "max righter", "font-weight='300' letter-spacing='2'")}`,

    // ---- feel-good in the bathroom
    "Abbey Toad": `<rect width='400' height='400' fill='#9cc3e0'/>
<g fill='#3f6b3a'><circle cx='40' cy='214' r='44'/><circle cx='110' cy='204' r='38'/><circle cx='330' cy='210' r='46'/><circle cx='390' cy='220' r='34'/></g>
<rect y='230' width='400' height='170' fill='#55595e'/>
<g fill='#f2f2ee'>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x='${8 + i * 50}' y='292' width='30' height='58'/>`).join("")}</g>
${[0, 1, 2, 3].map((i) => {
    const x = 80 + i * 74, c = ["#6a9a3a", "#7aa846", "#5d8a33", "#86b34f"][i];
    return `<ellipse cx='${x}' cy='292' rx='22' ry='16' fill='${c}'/><circle cx='${x - 9}' cy='276' r='7' fill='${c}'/><circle cx='${x + 9}' cy='276' r='7' fill='${c}'/>`
      + `<circle cx='${x - 9}' cy='275' r='3' fill='#111'/><circle cx='${x + 9}' cy='275' r='3' fill='#111'/><path d='M${x - 18} 306l-10 14M${x + 18} 306l12 12' stroke='${c}' stroke-width='6' stroke-linecap='round'/>`;
  }).join("")}
${t(28, 56, 26, "#fff", "the beadles", "font-weight='700' letter-spacing='2'")}
${t(30, 82, 16, "#eef6fb", "abbey toad")}`,

    "Partly Cloudy": `<defs><linearGradient id='a' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#f6b46a'/><stop offset='1' stop-color='#d9643a'/></linearGradient></defs>
<rect width='400' height='400' fill='url(#a)'/>
<circle cx='252' cy='208' r='86' fill='#ffd36e'/>
<g fill='#fff8ee'><circle cx='150' cy='276' r='46'/><circle cx='208' cy='254' r='58'/><circle cx='268' cy='282' r='42'/><rect x='104' y='276' width='206' height='48' rx='24'/></g>
<text x='28' y='60' font-family='${SERIF}' font-size='34' font-weight='700' fill='#2a1a0e'>bill weathers</text>
${t(30, 88, 17, "#3d2614", "partly cloudy", "letter-spacing='2'")}`,

    "Roomours": `<rect width='400' height='400' fill='#e8dccb'/>
<rect y='330' width='400' height='70' fill='#5a4a3c'/>
<path d='M120 330V180' stroke='#1e1a16' stroke-width='7'/><path d='M84 332h72' stroke='#1e1a16' stroke-width='8' stroke-linecap='round'/>
<rect x='104' y='132' width='32' height='56' rx='16' fill='#1e1a16'/><path d='M108 150h24M108 162h24' stroke='#8a7a6a' stroke-width='3'/>
<circle cx='278' cy='262' r='48' fill='#cfe3ee' fill-opacity='.85' stroke='#8a7a6a' stroke-width='3'/>
<path d='M252 246a30 30 0 0 1 22-18' stroke='#fff' stroke-width='6' fill='none' stroke-linecap='round'/>
<path d='M246 310h64l-10 20h-44z' fill='#1e1a16'/>
<text x='28' y='58' font-family='${SERIF}' font-size='30' letter-spacing='3' fill='#1e1a16'>FLEETWOOD MIC</text>
<text x='30' y='88' font-family='${SERIF}' font-size='22' font-style='italic' fill='#3d342c'>Roomours</text>`,

    "The Best of Earth, Wind & Wi-Fi": `<defs><linearGradient id='a' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#3a1508'/><stop offset='1' stop-color='#120604'/></linearGradient></defs>
<rect width='400' height='400' fill='url(#a)'/>
<path d='M200 168 340 352H60z' fill='#c0912b'/><path d='M200 168 340 352H200z' fill='#8f6a1c'/>
<g stroke='#f1c40f' stroke-width='9' fill='none' stroke-linecap='round'><path d='M170 140a42 42 0 0 1 60 0'/><path d='M146 116a76 76 0 0 1 108 0'/></g>
<circle cx='200' cy='162' r='7' fill='#f1c40f'/>
${t(28, 52, 13, "#f1c40f", "THE BEST OF", "letter-spacing='4'")}
${t(28, 80, 24, "#f1c40f", "EARTH, WIND &amp; WI-FI", "font-weight='800'")}`,

    // ---- shows on the televisions
    "Serverance": `<rect width='400' height='400' fill='#f1f4f4'/>
<path d='M0 120 170 196v80L0 400z' fill='#dfe5e6'/><path d='M400 120 230 196v80l170 124z' fill='#d5dcdd'/>
<path d='M0 400 170 276h60l170 124z' fill='#3f7d5a'/><path d='M0 120 170 196h60l170-76z' fill='#fafcfc'/>
<rect x='184' y='206' width='32' height='70' rx='3' fill='#0a1a24'/>
<g fill='#5cf08f'><circle cx='192' cy='218' r='2'/><circle cx='192' cy='234' r='2'/><circle cx='192' cy='250' r='2'/></g>
${t(28, 76, 40, "#0a1a24", "SERVERANCE", "font-weight='800' letter-spacing='3'")}`,

    "Slow Houses": `<rect width='400' height='400' fill='#6b705c'/>
<path d='M60 330c0-16 20-24 50-24h190c26 0 40 10 40 24z' fill='#d4a373'/>
<path d='M300 306c10-30 20-60 34-70M318 302c4-24 20-50 30-56' stroke='#d4a373' stroke-width='8' stroke-linecap='round' fill='none'/>
<circle cx='334' cy='236' r='6' fill='#1c1d18'/><circle cx='348' cy='246' r='6' fill='#1c1d18'/>
<path d='M110 306V226l80-58 80 58v80z' fill='#1c1d18'/><rect x='170' y='246' width='40' height='60' fill='#f2c879'/>
${t(28, 76, 40, "#fff", "Slow Houses", "font-weight='800' letter-spacing='-1'")}`,

    "The Beer": `<rect width='400' height='400' fill='#1d3557'/>
<rect y='300' width='400' height='14' fill='#e63946'/>
<g transform='translate(0 40)'><rect x='136' y='176' width='120' height='170' rx='14' fill='#f2b134'/>
<path d='M256 206c44 0 44 92 0 92' stroke='#f2b134' stroke-width='16' fill='none'/>
<g fill='#fffaf0'><circle cx='150' cy='176' r='22'/><circle cx='186' cy='166' r='26'/><circle cx='224' cy='170' r='24'/><circle cx='248' cy='180' r='16'/></g>
<path d='M164 150v-40a22 22 0 0 1 20-30 26 26 0 0 1 44 6 20 20 0 0 1 8 36v28z' fill='#fff'/></g>
${t(28, 76, 42, "#fff", "THE BEER", "font-weight='800' letter-spacing='2'")}`,

    "Shōfun": `<rect width='400' height='400' fill='#7f1d1d'/>
<circle cx='200' cy='236' r='112' fill='#f5d0a9'/>
<path d='M200 330 98 214a150 150 0 0 1 204 0z' fill='#120606'/>
<g stroke='#7f1d1d' stroke-width='3'><path d='M200 330 118 196M200 330 160 182M200 330V178M200 330l40-148M200 330l82-134'/></g>
${t(28, 76, 44, "#f5d0a9", "SHŌFUN", "font-weight='800' letter-spacing='5'")}`,

    "Ted Lasagne": `<rect width='400' height='400' fill='#1f4e8c'/>
<g transform='rotate(-4 200 250)'><rect x='86' y='170' width='228' height='150' fill='#f2c14e'/>
<rect x='86' y='162' width='40' height='16' fill='#fff' fill-opacity='.7'/><rect x='274' y='162' width='40' height='16' fill='#fff' fill-opacity='.7'/>
${t(200, 264, 50, "#1f4e8c", "REHEAT", "font-weight='900' text-anchor='middle' letter-spacing='2'")}</g>
${t(28, 76, 40, "#fff", "Ted Lasagne", "font-weight='800' letter-spacing='-1'")}`,

    "The Offline": `<rect width='400' height='400' fill='#f4f4f2'/>
<rect y='236' width='400' height='164' fill='#4a6fa5'/>
<rect x='166' y='270' width='68' height='34' rx='6' fill='#e0e6ef'/><rect x='234' y='278' width='26' height='18' fill='#9aa7b8'/>
<path d='M140 300c-40 0-40 40-80 40' stroke='#e0e6ef' stroke-width='5' fill='none' stroke-dasharray='10 8'/>
<text x='28' y='150' font-family='${MONO}' font-size='50' fill='#222'>the offline</text>`,
  };

  window.SavvyDemo = Object.assign(window.SavvyDemo || {}, { COVERS });
})();
