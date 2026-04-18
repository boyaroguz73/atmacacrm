export const TURKEY_CITIES = [
  'Adana','Adıyaman','Afyonkarahisar','Ağrı','Amasya','Ankara','Antalya','Artvin',
  'Aydın','Balıkesir','Bilecik','Bingöl','Bitlis','Bolu','Burdur','Bursa',
  'Çanakkale','Çankırı','Çorum','Denizli','Diyarbakır','Edirne','Elazığ','Erzincan',
  'Erzurum','Eskişehir','Gaziantep','Giresun','Gümüşhane','Hakkari','Hatay','Isparta',
  'Mersin','İstanbul','İzmir','Kars','Kastamonu','Kayseri','Kırklareli','Kırşehir',
  'Kocaeli','Konya','Kütahya','Malatya','Manisa','Kahramanmaraş','Mardin','Muğla',
  'Muş','Nevşehir','Niğde','Ordu','Rize','Sakarya','Samsun','Siirt','Sinop',
  'Sivas','Tekirdağ','Tokat','Trabzon','Tunceli','Şanlıurfa','Uşak','Van',
  'Yozgat','Zonguldak','Aksaray','Bayburt','Karaman','Kırıkkale','Batman','Şırnak',
  'Bartın','Ardahan','Iğdır','Yalova','Karabük','Kilis','Osmaniye','Düzce',
] as const;

export const CITY_DISTRICTS: Record<string, string[]> = {
  'İstanbul': [
    'Adalar','Arnavutköy','Ataşehir','Avcılar','Bağcılar','Bahçelievler','Bakırköy',
    'Başakşehir','Bayrampaşa','Beşiktaş','Beykoz','Beylikdüzü','Beyoğlu','Büyükçekmece',
    'Çatalca','Çekmeköy','Esenler','Esenyurt','Eyüpsultan','Fatih','Gaziosmanpaşa',
    'Güngören','Kadıköy','Kağıthane','Kartal','Küçükçekmece','Maltepe','Pendik',
    'Sancaktepe','Sarıyer','Silivri','Sultanbeyli','Sultangazi','Şile','Şişli',
    'Tuzla','Ümraniye','Üsküdar','Zeytinburnu',
  ],
  'Ankara': [
    'Akyurt','Altındağ','Ayaş','Bala','Beypazarı','Çamlıdere','Çankaya','Çubuk',
    'Elmadağ','Etimesgut','Evren','Gölbaşı','Güdül','Haymana','Kalecik','Kazan',
    'Keçiören','Kızılcahamam','Mamak','Nallıhan','Polatlı','Pursaklar','Sincan',
    'Şereflikoçhisar','Yenimahalle',
  ],
  'İzmir': [
    'Aliağa','Balçova','Bayındır','Bayraklı','Bergama','Beydağ','Bornova','Buca',
    'Çeşme','Çiğli','Dikili','Foça','Gaziemir','Güzelbahçe','Karabağlar','Karaburun',
    'Karşıyaka','Kemalpaşa','Kınık','Kiraz','Konak','Menderes','Menemen','Narlıdere',
    'Ödemiş','Seferihisar','Selçuk','Tire','Torbalı','Urla',
  ],
  'Bursa': [
    'Büyükorhan','Gemlik','Gürsu','Harmancık','İnegöl','İznik','Karacabey','Keles',
    'Kestel','Mudanya','Mustafakemalpaşa','Nilüfer','Orhaneli','Orhangazi','Osmangazi',
    'Yenişehir','Yıldırım',
  ],
  'Antalya': [
    'Akseki','Aksu','Alanya','Demre','Döşemealtı','Elmalı','Finike','Gazipaşa',
    'Gündoğmuş','İbradı','Kaş','Kemer','Kepez','Konyaaltı','Korkuteli','Kumluca',
    'Manavgat','Muratpaşa','Serik',
  ],
  'Adana': [
    'Aladağ','Ceyhan','Çukurova','Feke','İmamoğlu','Karaisalı','Karataş','Kozan',
    'Pozantı','Saimbeyli','Sarıçam','Seyhan','Tufanbeyli','Yumurtalık','Yüreğir',
  ],
  'Konya': [
    'Ahırlı','Akören','Akşehir','Altınekin','Beyşehir','Bozkır','Cihanbeyli',
    'Çeltik','Çumra','Derbent','Derebucak','Doğanhisar','Emirgazi','Ereğli',
    'Güneysınır','Hadim','Halkapınar','Hüyük','Ilgın','Kadınhanı','Karapınar',
    'Karatay','Kulu','Meram','Sarayönü','Selçuklu','Seydişehir','Taşkent',
    'Tuzlukçu','Yalıhüyük','Yunak',
  ],
  'Gaziantep': [
    'Araban','İslahiye','Karkamış','Nizip','Nurdağı','Oğuzeli','Şahinbey','Şehitkamil','Yavuzeli',
  ],
  'Kocaeli': [
    'Başiskele','Çayırova','Darıca','Derince','Dilovası','Gebze','Gölcük',
    'İzmit','Kandıra','Karamürsel','Kartepe','Körfez',
  ],
  'Mersin': [
    'Akdeniz','Anamur','Aydıncık','Bozyazı','Çamlıyayla','Erdemli','Gülnar',
    'Mezitli','Mut','Silifke','Tarsus','Toroslar','Yenişehir',
  ],
  'Kayseri': [
    'Akkışla','Bünyan','Develi','Felahiye','Hacılar','İncesu','Kocasinan',
    'Melikgazi','Özvatan','Pınarbaşı','Sarıoğlan','Sarız','Talas','Tomarza',
    'Yahyalı','Yeşilhisar',
  ],
  'Diyarbakır': [
    'Bağlar','Bismil','Çermik','Çınar','Çüngüş','Dicle','Eğil','Ergani',
    'Hani','Hazro','Kayapınar','Kocaköy','Kulp','Lice','Silvan','Sur','Yenişehir',
  ],
  'Samsun': [
    'Alaçam','Asarcık','Atakum','Ayvacık','Bafra','Canik','Çarşamba','Havza',
    'İlkadım','Kavak','Ladik','Ondokuzmayıs','Salıpazarı','Tekkeköy','Terme','Vezirköprü',
  ],
  'Denizli': [
    'Acıpayam','Babadağ','Baklan','Bekilli','Beyağaç','Bozkurt','Buldan','Çal',
    'Çameli','Çardak','Çivril','Güney','Honaz','Kale','Merkezefendi','Pamukkale',
    'Sarayköy','Serinhisar','Tavas',
  ],
  'Eskişehir': [
    'Alpu','Beylikova','Çifteler','Günyüzü','Han','İnönü','Mahmudiye','Mihalgazi',
    'Mihalıççık','Odunpazarı','Sarıcakaya','Seyitgazi','Sivrihisar','Tepebaşı',
  ],
  'Sakarya': [
    'Adapazarı','Akyazı','Arifiye','Erenler','Ferizli','Geyve','Hendek',
    'Karapürçek','Karasu','Kaynarca','Kocaali','Pamukova','Sapanca',
    'Serdivan','Söğütlü','Taraklı',
  ],
  'Tekirdağ': [
    'Çerkezköy','Çorlu','Ergene','Hayrabolu','Kapaklı','Malkara','Marmaraereğlisi',
    'Muratlı','Saray','Süleymanpaşa','Şarköy',
  ],
  'Manisa': [
    'Ahmetli','Akhisar','Alaşehir','Demirci','Gördes','Kırkağaç','Köprübaşı',
    'Kula','Salihli','Sarıgöl','Saruhanlı','Selendi','Soma','Şehzadeler',
    'Turgutlu','Yunusemre',
  ],
  'Trabzon': [
    'Akçaabat','Araklı','Arsin','Beşikdüzü','Çarşıbaşı','Çaykara','Dernekpazarı',
    'Düzköy','Hayrat','Köprübaşı','Maçka','Of','Ortahisar','Sürmene','Şalpazarı',
    'Tonya','Vakfıkebir','Yomra',
  ],
  'Balıkesir': [
    'Altıeylül','Ayvalık','Balya','Bandırma','Bigadiç','Burhaniye','Dursunbey',
    'Edremit','Erdek','Gömeç','Gönen','Havran','İvrindi','Karesi','Kepsut',
    'Manyas','Marmara','Savaştepe','Sındırgı','Susurluk',
  ],
  'Muğla': [
    'Bodrum','Dalaman','Datça','Fethiye','Kavaklıdere','Köyceğiz','Marmaris',
    'Menteşe','Milas','Ortaca','Seydikemer','Ula','Yatağan',
  ],
  'Aydın': [
    'Bozdoğan','Buharkent','Çine','Didim','Efeler','Germencik','İncirliova',
    'Karacasu','Karpuzlu','Koçarlı','Köşk','Kuşadası','Kuyucak','Nazilli',
    'Söke','Sultanhisar','Yenipazar',
  ],
  'Hatay': [
    'Altınözü','Antakya','Arsuz','Belen','Defne','Dörtyol','Erzin','Hassa',
    'İskenderun','Kırıkhan','Kumlu','Payas','Reyhanlı','Samandağ','Yayladağı',
  ],
  'Malatya': [
    'Akçadağ','Arapgir','Arguvan','Battalgazi','Darende','Doğanşehir','Doğanyol',
    'Hekimhan','Kale','Kuluncak','Pütürge','Yazıhan','Yeşilyurt',
  ],
  'Kahramanmaraş': [
    'Afşin','Andırın','Çağlayancerit','Dulkadiroğlu','Ekinözü','Elbistan','Göksun',
    'Nurhak','Onikişubat','Pazarcık','Türkoğlu',
  ],
  'Şanlıurfa': [
    'Akçakale','Birecik','Bozova','Ceylanpınar','Eyyübiye','Halfeti','Haliliye',
    'Harran','Hilvan','Karaköprü','Siverek','Suruç','Viranşehir',
  ],
};
