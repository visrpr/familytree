/*
	FAMILY DATA EDITING GUIDE

	Add or edit one person object per line:
	- id: unique lowercase identifier. Do not change it after linking children.
	- name: name shown on the family tree and detail page.
	- name: name shown on the family tree and detail page.
	- maidenName: optional unmarried name shown beneath the main name in brackets.
	- gender: male, female, or unknown.
	- birth / death: use four-digit years, or an empty string when unknown.
	- birth / death: use four-digit years, or an empty string when unknown.
	- marriage / divorce or marriageYear / divorceYear: optional four-digit timeline event years.
	- spouse: id of the spouse record. Omit it to show a Spouse placeholder.
	- spouse: id of the spouse record. Omit it to show a Spouse placeholder.
	- siblings: optional sibling ids when shared parents are not recorded.
	- parents: optional parent ids when the parent branch is not part of the main tree.
	- children: child ids in eldest-to-youngest order, from left to right.
	- photos: optional array of image URLs for the detail-page carousel.
	- description, phone, email, address: optional detail-page information.

	Example:
	{
		id: "person-id",
		name: "Person Name",
		gender: "male",
		birth: "1900",
		death: "2000",
		spouse: "spouse-id",
		children: ["eldest-child-id", "youngest-child-id"],
		photos: ["https://example.com/photo.jpg"],
		description: "A short description.",
		phone: "+1 555 0100",
		email: "person@example.com",
		address: "Address here"
	},

	Keep every id used in spouse or children in this same list.
*/
const family = [
// Family founder
{id:"padmanabh",name:"Padmanabh Prabhu",gender:"male",birth:"1900",death:"2000",children:["ganga","dutt","ram","krishna"]},
{id:"ganga",name:"Ganga Prabhu",gender:"female",birth:"",death:"",children:[]},

// Dutt branch
{id:"dutt",name:"Dutt Prabhu",gender:"male",birth:"",death:"",children:["prema","baby","ratnakar"]},
{id:"prema",name:"Prema",gender:"female",birth:"",death:"",children:[]},
{id:"baby",name:"Baby",gender:"female",birth:"",death:"",children:[]},
{id:"ratnakar",name:"Ratnakar",gender:"male",birth:"",death:"",children:[]},

// Ram branch
{id:"ram",name:"Ram Prabhu",gender:"male",birth:"",death:"",children:["narasim","govind","hari","mukund","madhu","kalyani","triveni"]},

// Narasim branch
{id:"narasim",name:"Narasim Ram Prabhu",gender:"male",birth:"",death:"",children:["digambar","kashinath","vignesh","vijayi","sunanda","sapati","budkulo","narasim-unknown"]},
{id:"digambar",name:"Digambar",gender:"male",birth:"",death:"",children:["ashish","digambar-u1","digambar-u2","digambar-u3"]},
{id:"ashish",name:"Ashish",gender:"unknown",birth:"",death:"",children:[]},
{id:"digambar-u1",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"digambar-u2",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"digambar-u3",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"kashinath",name:"Kashinath",gender:"male",birth:"",death:"",children:["pavitra","prashanth"]},
{id:"prashanth",name:"Prashanth",gender:"male",birth:"",death:"",children:["mayur","shravan"]},
{id:"pavitra",name:"Pavitra",gender:"female",birth:"",death:"",children:[]},
{id:"vignesh",name:"Vignesh",gender:"male",birth:"",death:"",children:["vignesh-u1","vignesh-u2","vignesh-u3"]},
{id:"vignesh-u1",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"vignesh-u2",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"vignesh-u3",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"vijayi",name:"Vijayi",gender:"female",birth:"",death:"",children:["vijayi-u1","vijayi-u2","vijayi-u3"]},
{id:"vijayi-u1",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"vijayi-u2",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"vijayi-u3",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"sunanda",name:"Sunanda",gender:"female",birth:"",death:"",children:[]},
{id:"sapati",name:"Saraswati",gender:"female",birth:"",death:"",children:[]},
{id:"budkulo",name:"Chitra",gender:"female",birth:"",death:"",children:[]},
{id:"narasim-unknown",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},

// Govind branch
{id:"govind",name:"Govind Rao Ram Prabhu",gender:"male",birth:"",death:"",children:["murlidhar","gajanand","veenu","kamli","pari"]},
{id:"murlidhar",name:"Murlidhar",gender:"unknown",birth:"",death:"",children:["murlidhar-daughter","murlidhar-u1","murlidhar-u2","murlidhar-u3","murlidhar-u4"]},
{id:"murlidhar-daughter",name:"India",gender:"female",birth:"",death:"",children:[]},
{id:"murlidhar-u1",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"murlidhar-u2",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"murlidhar-u3",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"murlidhar-u4",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"gajanand",name:"Gajanand",gender:"unknown",birth:"",death:"",children:["gajanand-u1","gajanand-u2"]},
{id:"gajanand-u1",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"gajanand-u2",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"veenu",name:"Veena",gender:"unknown",birth:"",death:"",children:["veenu-u1","veenu-u2"]},
{id:"veenu-u1",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"veenu-u2",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"kamli",name:"Kamli",gender:"unknown",birth:"",death:"",children:["nagesh","kamli-u1","kamli-u2"]},
{id:"nagesh",name:"Nagesh",gender:"male",birth:"",death:"",children:[]},
{id:"kamli-u1",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"kamli-u2",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"pari",name:"Vanmala",gender:"unknown",birth:"",death:"",children:["pari-u1"]},
{id:"pari-u1",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},

// Hari branch
{id:"hari",name:"Hari Ram Prabhu",gender:"male",birth:"",death:"",children:["rohidas","ullas","vasudev","sumana"]},
{id:"rohidas",name:"Rohidas Prabhu",gender:"unknown",birth:"",death:"",children:["srinivas","rajesh"]},
{id:"srinivas",name:"Srinivas Prabhu",gender:"male",birth:"",death:"",spouse:"roopa-s-prabhu",children:["bhumika","vijay"]},
{id:"taranath-bhandarkar",name:"Taranath Bhandarkar",gender:"male",birth:"",death:"",spouse:"chandri",children:["roopa-s-prabhu","pandurang-bhandarkar"]},
{id:"chandri",name:"Chandri",gender:"female",birth:"",death:"",spouse:"taranath-bhandarkar",children:[]},
{id:"roopa-s-prabhu",name:"Roopa S Prabhu",maidenName:"Bhandarkar",gender:"female",birth:"",death:"",spouse:"srinivas",children:[]},
{id:"pandurang-bhandarkar",name:"Pandurang Bhandarkar",gender:"male",birth:"",death:"",spouse:"shambavi-bhandarker",children:["dhruti"]},
{id:"shambavi-bhandarker",name:"Shambavi Bhandarker",gender:"female",birth:"",death:"",spouse:"pandurang-bhandarkar",children:[]},
{id:"dhruti",name:"Dhruti",gender:"female",birth:"",death:"",children:[]},
{id:"bhumika",name:"Bhumika",gender:"female",birth:"",death:"",children:[]},
{id:"vijay",name:"Vijay",gender:"male",birth:"",death:"",photos:["https://i.ibb.co/N68KLkkX/artistic-silhouette-portrait-man-profile-260nw-2689672843.jpg"],photos:["https://i.ibb.co/B5vC6g8J/artistic-silhouette-portrait-man-profile-260nw-2689672843.jpg"],photos:["https://i.ibb.co/jkjp6Cvp/Digital-Photo.jpg"],children:[]},
{id:"rajesh",name:"Rajesh",gender:"male",birth:"",death:"",children:["miraya"]},
{id:"miraya",name:"Miraya",gender:"female",birth:"",death:"",children:[]},
{id:"ullas",name:"Ullas Prabhu",gender:"unknown",birth:"",death:"",children:["raghu","anupama"]},
{id:"raghu",name:"Raghu",gender:"male",birth:"",death:"",children:["nisha","dia"]},
{id:"nisha",name:"Nisha",gender:"female",birth:"",death:"",children:[]},
{id:"dia",name:"Dia",gender:"female",birth:"",death:"",children:[]},
{id:"anupama",name:"Anupama",gender:"female",birth:"",death:"",children:["yogesh"]},
{id:"yogesh",name:"Yogesh",gender:"male",birth:"",death:"",children:[]},
{id:"vasudev",name:"Vasudev Prabhu",gender:"unknown",birth:"",death:"",children:["vishwananth","chetan"]},
{id:"vishwananth",name:"Vishwananth",gender:"male",birth:"",death:"",children:["adya","anant"]},
{id:"adya",name:"Adya",gender:"female",birth:"",death:"",children:[]},
{id:"anant",name:"Anant",gender:"male",birth:"",death:"",children:[]},
{id:"chetan",name:"Chetan",gender:"male",birth:"",death:"",children:[]},
{id:"sumana",name:"Sumana Prabhu",gender:"unknown",birth:"",death:"",children:["kashinath-sumana"]},
{id:"mayur",name:"Mayur",gender:"male",birth:"",death:"",children:[]},
{id:"shravan",name:"Shravan",gender:"male",birth:"",death:"",children:[]},
{id:"akanksha",name:"Akanksha",gender:"female",birth:"",death:"",children:[]},
{id:"kashinath-sumana",name:"Kashinath",gender:"male",birth:"",death:"",children:["akanksha"]},

// Mukund and Madhu branches
{id:"mukund",name:"Mukund Ram Prabhu",gender:"male",birth:"",death:"",children:["dinkar"]},
{id:"dinkar",name:"Dinkar",gender:"unknown",birth:"",death:"",children:[]},
{id:"madhu",name:"Madhu Ram Prabhu",gender:"male",birth:"",death:"",children:["satish","ramesh"]},
{id:"satish",name:"Satish",gender:"unknown",birth:"",death:"",children:[]},
{id:"ramesh",name:"Ramesh",gender:"unknown",birth:"",death:"",children:[]},

// Kalyani branch
{id:"kalyani",name:"Kalyani Ram Prabhu",gender:"female",birth:"",death:"",children:["gopinath","dayanand","prabakar","kalyani-u1","kalyani-u2"]},
{id:"gopinath",name:"Gopinath",gender:"unknown",birth:"",death:"",children:[]},
{id:"dayanand",name:"Dayanand",gender:"unknown",birth:"",death:"",children:[]},
{id:"prabakar",name:"Prabakar",gender:"unknown",birth:"",death:"",children:[]},
{id:"kalyani-u1",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"kalyani-u2",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},

// Triveni branch
{id:"triveni",name:"Triveni Ram Prabhu",gender:"female",birth:"",death:"",children:["jagdish","sadanand","uday","ganesh","triveni-u1","triveni-u2"]},
{id:"jagdish",name:"Jagdish",gender:"unknown",birth:"",death:"",children:[]},
{id:"sadanand",name:"Sadanand",gender:"unknown",birth:"",death:"",children:[]},
{id:"uday",name:"Uday",gender:"unknown",birth:"",death:"",children:[]},
{id:"ganesh",name:"Ganesh",gender:"unknown",birth:"",death:"",children:[]},
{id:"triveni-u1",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"triveni-u2",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},

// Krishna branch
{id:"krishna",name:"Krishna Prabhu",gender:"male",birth:"",death:"",children:["mohan","krishna-u1","krishna-u2","krishna-u3","krishna-u4","krishna-u5"]},
{id:"mohan",name:"Mohan",gender:"unknown",birth:"",death:"",children:[]},
{id:"krishna-u1",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"krishna-u2",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"krishna-u3",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"krishna-u4",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]},
{id:"krishna-u5",name:"Unknown",gender:"unknown",birth:"",death:"",children:[]}
];
window.FAMILY_DATA = family;
