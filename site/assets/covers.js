// The demo's album and show covers: parodies of well-known records and series, with a near name and a playful
// twist on the house (uptime, firmware, sensors, Wi-Fi). Each is a real photo with the sleeve's type set over it:
// the photos are frames from Mixkit's free stock footage (Mixkit Free License); nothing is taken from the
// originals. house.js shows SavvyDemo.COVERS[album].
(() => {
  const at = (name) => `assets/covers/${name}.jpg`;
  const COVERS = {
    "Kinda Blue": at("kinda-blue"),
    "Time In": at("time-in"),
    "Giant Stairs": at("giant-stairs"),
    "Waltz for Debbie": at("waltz-for-debbie"),
    "Apollo 404": at("apollo-404"),
    "Ambient 1: Music for Airplane Mode": at("music-for-airplane-mode"),
    "Spacebar": at("spacebar"),
    "The Blue Notifications": at("the-blue-notifications"),
    "Abbey Toad": at("abbey-toad"),
    "Partly Cloudy": at("partly-cloudy"),
    "Roomours": at("roomours"),
    "The Best of Earth, Wind & Wi-Fi": at("earth-wind-wi-fi"),
    "Serverance": at("serverance"),
    "Slow Houses": at("slow-houses"),
    "The Beer": at("the-beer"),
    "Shōfun": at("shofun"),
    "Ted Lasagne": at("ted-lasagne"),
    "The Offline": at("the-offline"),
  };
  window.SavvyDemo = Object.assign(window.SavvyDemo || {}, { COVERS });
})();
