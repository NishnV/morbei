// Countries with their states/provinces/regions
// Covers major shipping destinations worldwide
const COUNTRIES = {
  'India': [
    'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
    'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
    'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
    'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
    'Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh',
    'Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir',
    'Ladakh','Lakshadweep','Puducherry',
  ],
  'United States': [
    'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
    'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
    'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
    'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire',
    'New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio',
    'Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota',
    'Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia',
    'Wisconsin','Wyoming','District of Columbia',
  ],
  'United Kingdom': [
    'England','Scotland','Wales','Northern Ireland',
  ],
  'Canada': [
    'Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland and Labrador',
    'Northwest Territories','Nova Scotia','Nunavut','Ontario','Prince Edward Island',
    'Quebec','Saskatchewan','Yukon',
  ],
  'Australia': [
    'Australian Capital Territory','New South Wales','Northern Territory','Queensland',
    'South Australia','Tasmania','Victoria','Western Australia',
  ],
  'United Arab Emirates': [
    'Abu Dhabi','Ajman','Dubai','Fujairah','Ras Al Khaimah','Sharjah','Umm Al Quwain',
  ],
  'Singapore': [],
  'Germany': [
    'Baden-Württemberg','Bavaria','Berlin','Brandenburg','Bremen','Hamburg','Hesse',
    'Lower Saxony','Mecklenburg-Vorpommern','North Rhine-Westphalia','Rhineland-Palatinate',
    'Saarland','Saxony','Saxony-Anhalt','Schleswig-Holstein','Thuringia',
  ],
  'France': [
    'Auvergne-Rhône-Alpes','Bourgogne-Franche-Comté','Brittany','Centre-Val de Loire',
    'Corsica','Grand Est','Hauts-de-France','Île-de-France','Normandy',
    'Nouvelle-Aquitaine','Occitanie','Pays de la Loire','Provence-Alpes-Côte d\'Azur',
  ],
  'Japan': [
    'Hokkaido','Aomori','Iwate','Miyagi','Akita','Yamagata','Fukushima','Ibaraki',
    'Tochigi','Gunma','Saitama','Chiba','Tokyo','Kanagawa','Niigata','Toyama',
    'Ishikawa','Fukui','Yamanashi','Nagano','Gifu','Shizuoka','Aichi','Mie',
    'Shiga','Kyoto','Osaka','Hyogo','Nara','Wakayama','Tottori','Shimane',
    'Okayama','Hiroshima','Yamaguchi','Tokushima','Kagawa','Ehime','Kochi',
    'Fukuoka','Saga','Nagasaki','Kumamoto','Oita','Miyazaki','Kagoshima','Okinawa',
  ],
  'South Korea': [
    'Seoul','Busan','Daegu','Incheon','Gwangju','Daejeon','Ulsan','Sejong',
    'Gyeonggi','Gangwon','Chungbuk','Chungnam','Jeonbuk','Jeonnam','Gyeongbuk',
    'Gyeongnam','Jeju',
  ],
  'Italy': [
    'Abruzzo','Basilicata','Calabria','Campania','Emilia-Romagna',
    'Friuli Venezia Giulia','Lazio','Liguria','Lombardy','Marche','Molise',
    'Piedmont','Puglia','Sardinia','Sicily','Trentino-South Tyrol','Tuscany',
    'Umbria','Aosta Valley','Veneto',
  ],
  'Spain': [
    'Andalusia','Aragon','Asturias','Balearic Islands','Basque Country',
    'Canary Islands','Cantabria','Castile and León','Castilla-La Mancha',
    'Catalonia','Extremadura','Galicia','La Rioja','Madrid','Murcia','Navarre','Valencia',
  ],
  'Netherlands': [
    'Drenthe','Flevoland','Friesland','Gelderland','Groningen','Limburg',
    'North Brabant','North Holland','Overijssel','South Holland','Utrecht','Zeeland',
  ],
  'Saudi Arabia': [
    'Riyadh','Makkah','Madinah','Eastern Province','Asir','Tabuk','Hail',
    'Northern Borders','Jazan','Najran','Al Bahah','Al Jawf','Qassim',
  ],
  'Malaysia': [
    'Johor','Kedah','Kelantan','Malacca','Negeri Sembilan','Pahang','Penang',
    'Perak','Perlis','Sabah','Sarawak','Selangor','Terengganu',
    'Kuala Lumpur','Labuan','Putrajaya',
  ],
  'Indonesia': [
    'Aceh','Bali','Banten','Bengkulu','Central Java','Central Kalimantan',
    'Central Sulawesi','East Java','East Kalimantan','East Nusa Tenggara',
    'Gorontalo','Jakarta','Jambi','Lampung','Maluku','North Kalimantan',
    'North Maluku','North Sulawesi','North Sumatra','Papua','Riau',
    'Riau Islands','South Kalimantan','South Sulawesi','South Sumatra',
    'Southeast Sulawesi','West Java','West Kalimantan','West Nusa Tenggara',
    'West Papua','West Sulawesi','West Sumatra','Yogyakarta',
  ],
  'Thailand': [
    'Bangkok','Chiang Mai','Chiang Rai','Chonburi','Khon Kaen','Nakhon Ratchasima',
    'Nonthaburi','Pathum Thani','Phuket','Samut Prakan','Songkhla','Surat Thani',
  ],
  'Bangladesh': [
    'Barishal','Chattogram','Dhaka','Khulna','Mymensingh','Rajshahi','Rangpur','Sylhet',
  ],
  'Sri Lanka': [
    'Central','Eastern','North Central','Northern','North Western',
    'Sabaragamuwa','Southern','Uva','Western',
  ],
  'Nepal': [
    'Province 1','Madhesh','Bagmati','Gandaki','Lumbini','Karnali','Sudurpashchim',
  ],
  'Pakistan': [
    'Balochistan','Khyber Pakhtunkhwa','Punjab','Sindh','Islamabad',
    'Azad Kashmir','Gilgit-Baltistan',
  ],
  'Brazil': [
    'Acre','Alagoas','Amapá','Amazonas','Bahia','Ceará','Distrito Federal',
    'Espírito Santo','Goiás','Maranhão','Mato Grosso','Mato Grosso do Sul',
    'Minas Gerais','Pará','Paraíba','Paraná','Pernambuco','Piauí',
    'Rio de Janeiro','Rio Grande do Norte','Rio Grande do Sul','Rondônia',
    'Roraima','Santa Catarina','São Paulo','Sergipe','Tocantins',
  ],
  'Mexico': [
    'Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas',
    'Chihuahua','Coahuila','Colima','Durango','Guanajuato','Guerrero','Hidalgo',
    'Jalisco','Mexico City','México','Michoacán','Morelos','Nayarit','Nuevo León',
    'Oaxaca','Puebla','Querétaro','Quintana Roo','San Luis Potosí','Sinaloa',
    'Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz','Yucatán','Zacatecas',
  ],
  'South Africa': [
    'Eastern Cape','Free State','Gauteng','KwaZulu-Natal','Limpopo',
    'Mpumalanga','North West','Northern Cape','Western Cape',
  ],
  'New Zealand': [
    'Auckland','Bay of Plenty','Canterbury','Gisborne','Hawke\'s Bay',
    'Manawatū-Whanganui','Marlborough','Nelson','Northland','Otago',
    'Southland','Taranaki','Tasman','Waikato','Wellington','West Coast',
  ],
  'China': [
    'Beijing','Tianjin','Shanghai','Chongqing','Hebei','Shanxi','Liaoning',
    'Jilin','Heilongjiang','Jiangsu','Zhejiang','Anhui','Fujian','Jiangxi',
    'Shandong','Henan','Hubei','Hunan','Guangdong','Hainan','Sichuan',
    'Guizhou','Yunnan','Shaanxi','Gansu','Qinghai','Taiwan','Inner Mongolia',
    'Guangxi','Tibet','Ningxia','Xinjiang','Hong Kong','Macau',
  ],
  'Philippines': [
    'Metro Manila','Cordillera','Ilocos','Cagayan Valley','Central Luzon',
    'Calabarzon','Mimaropa','Bicol','Western Visayas','Central Visayas',
    'Eastern Visayas','Zamboanga Peninsula','Northern Mindanao','Davao',
    'Soccsksargen','Caraga','Bangsamoro',
  ],
  'Vietnam': [
    'Ha Noi','Ho Chi Minh City','Da Nang','Hai Phong','Can Tho',
  ],
  'Nigeria': [
    'Lagos','Abuja','Kano','Rivers','Oyo','Kaduna','Ogun','Anambra',
    'Delta','Imo','Enugu','Edo',
  ],
  'Kenya': [
    'Nairobi','Mombasa','Kisumu','Nakuru','Eldoret',
  ],
  'Egypt': [
    'Cairo','Alexandria','Giza','Shubra El Kheima','Port Said','Suez','Luxor','Aswan',
  ],
  'Turkey': [
    'Istanbul','Ankara','Izmir','Bursa','Antalya','Adana','Konya','Gaziantep',
  ],
  'Russia': [
    'Moscow','Saint Petersburg','Novosibirsk','Yekaterinburg','Kazan',
  ],
  'Sweden': [
    'Stockholm','Gothenburg','Malmö','Uppsala','Västerås',
  ],
  'Switzerland': [
    'Zurich','Bern','Lucerne','St. Gallen','Lausanne','Basel',
  ],
  'Ireland': [
    'Leinster','Munster','Connacht','Ulster',
  ],
  'Portugal': [
    'Lisbon','Porto','Braga','Aveiro','Faro','Coimbra',
  ],
  'Poland': [
    'Greater Poland','Kuyavian-Pomeranian','Lesser Poland','Łódź','Lower Silesian',
    'Lublin','Lubusz','Masovian','Opole','Podlaskie','Pomeranian','Silesian',
    'Subcarpathian','Świętokrzyskie','Warmian-Masurian','West Pomeranian',
  ],
  'Belgium': [
    'Brussels','Flanders','Wallonia',
  ],
  'Austria': [
    'Burgenland','Carinthia','Lower Austria','Upper Austria','Salzburg',
    'Styria','Tyrol','Vorarlberg','Vienna',
  ],
  'Denmark': [
    'Capital','Central Denmark','North Denmark','Region Zealand','Southern Denmark',
  ],
  'Norway': [
    'Oslo','Rogaland','Møre og Romsdal','Nordland','Viken','Innlandet',
    'Vestfold og Telemark','Agder','Vestland','Trøndelag','Troms og Finnmark',
  ],
  'Finland': [
    'Helsinki','Tampere','Turku','Oulu','Espoo',
  ],
  'Qatar': ['Qatar'],
  'Bahrain': ['Bahrain'],
  'Kuwait': [
    'Al Asimah','Hawalli','Farwaniya','Mubarak Al-Kabeer','Ahmadi','Jahra',
  ],
  'Oman': [
    'Muscat','Dhofar','Al Batinah North','Al Batinah South','Al Dakhiliyah',
    'Al Sharqiyah North','Al Sharqiyah South','Al Dhahirah',
  ],
};

export const COUNTRY_LIST = Object.keys(COUNTRIES).sort();

export function getStatesForCountry(country) {
  return COUNTRIES[country] || [];
}

export default COUNTRIES;
