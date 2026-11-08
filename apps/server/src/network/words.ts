/**
 * Short, common, easy-to-type English words for generated network-access passphrases
 * (`generatePassphrase`). Lower case, 3 to 9 letters, no duplicates (a test keeps it so).
 */
export const PASSPHRASE_WORDS: readonly string[] = `
able acid acorn actor adapt adult agent agree ahead aim air alarm album alert alien alley
alpine amber amount anchor angle ankle answer apple april apron arch arena argue arm armor
army arrow art ash aspen atlas atom attic audio aunt autumn avenue award awake axis bacon
badge bag bake balcony ball bamboo banana band bank barn barrel basil basket bath beach
beam bean bear beard beat bee beetle bell belt bench berry bike bird biscuit bishop bitter
blade blank blast blaze blend blink block bloom blue board boat body bolt bone bonus book
boost boot border bottle bounce bowl box brain branch brass brave bread breeze brick bridge
brief bright brisk broom brush bubble bucket buddy budget buffalo bugle build bulb bundle
bunny burger burst bus butter button cabin cable cactus cake calm camel camera camp canal
candle candy canoe canvas canyon cape captain car carbon card cargo carpet carrot cart case
castle cat cave cedar cello cereal chain chair chalk champ chapel charm chart chase cheese
chef cherry chess chest chick chief child chili chimney chin chip choir chorus cider cinema
circle city clam clap clay clerk cliff climb clock cloud clover clown club coach coal coast
coat cobra cocoa coconut code coffee coin collar color comet comic compass cookie copper
coral cord corn cottage cotton couch cousin cove cow crab craft crane crater crayon cream
creek crew cricket crisp crop cross crowd crown crumb crystal cube cup curtain curve cushion
cycle daisy dance dawn deck deer delta denim depth desert desk dial diary diesel dinner
dish diver dock doctor dog dollar dolphin donkey donut door dove dragonfly drama drawer
dream dress drift drill drum duck dune dusk dust eagle earth easel echo eclipse edge eel
egg elbow elder elk ember empty engine entry envoy epic equal error essay estate ethic
event exit fabric falcon fame family fancy farm feast feather fence fern ferry festival
fiber field fig film finch finger fire fish flag flame flash fleet flint float flock flood
floor flour flower flute focus fog foil folk forest forge fork fossil fox frame frost fruit
fudge fuel gadget galaxy garden garlic gate gauge gecko gem genre ghost giant ginger giraffe
glass glide globe glove glow glue goat gold golf goose gopher gospel grain granite grape
graph grass gravel gravy green grid grill grove guitar gulf gym habit hammer hamster hand
harbor harp harvest hat hawk hazel heart hedge helmet hen herb hero heron hill hinge hippo
hobby hockey honey hood hook horizon horn horse hotel hound house hub humor hut iceberg
icon idea igloo inch index ink input insect iron island ivory ivy jacket jaguar jam jar
jazz jelly jet jewel jigsaw jockey judge juice jungle kayak kernel kettle key kidney king
kite kitten kiwi knee knife knot koala label ladder lagoon lake lamb lamp lantern laptop
lark laser latch lava lawn layer leaf ledge lemon lens leopard letter lever library lily
lime linen lion lizard llama lobster locket lodge logic lotus lunar lunch lynx magnet
mango manor maple marble market marsh mask meadow medal melon memory mentor menu metal
meteor mint mirror mitten moat model mole mongoose moon moose mosaic moss moth motor
mountain mouse muffin mule mural museum mushroom music mustard nail napkin native nebula
needle nest net nickel noble noodle north notch novel nugget nurse nutmeg oak oasis ocean
octopus olive omelet onion opal opera orange orbit orchard orchid organ otter outlet oval
oven owl oyster paddle page paint palace palm panda panel panther paper parade parcel park
parrot pasta patch path peach peanut pear pebble pecan pedal pelican pencil pepper piano
pickle picnic pigeon pillow pilot pine pirate pizza planet plank plaza plum pocket poem
polar pond pony poppy porch potato pottery powder prairie prism prize puddle pulse pumpkin
puppet puppy puzzle python quail quartz queen quest quill quilt quiz rabbit raccoon radar
radio raft rain raisin rake ranch raven razor recipe reef relay ribbon rice ridge rifle
ring river road robin robot rocket rodeo roof rook rope rose rover ruby rudder rug ruler
saddle safari saga sail salad salmon salt sand sandal satin saucer sauna scale scarf school
scooter scout screen scroll seal season seed shark sheep shelf shell sherpa shield ship
shirt shoe shore shovel shrimp signal silk silver singer siren sketch ski skunk sky sled
slope sloth smile snail snake snow soap soccer sock sofa solar soup spark sparrow spear
sphere spice spider spinach spoon spring sprout spruce squad squid stable stadium stamp
star statue steam steel stem stereo stone stool storm stove straw stream street string
studio sugar suit summit sun surf swamp swan sweater swing sword syrup table tablet taco
tail talent tango tank tea teapot temple tennis tent thistle thorn thread thunder ticket
tide tiger timber toast toffee tomato tonic topaz torch tornado tortoise towel tower toy
track tractor trail train tram tree trick trolley trophy trout truck trumpet tulip tuna
tunnel turkey turnip turtle tutor twig umbrella unicorn urban vacuum valley valve van vase
velvet vessel violet violin visor voice volcano voyage waffle wagon walnut walrus wand
wave wax weasel whale wheat wheel whistle willow window winter wizard wolf wombat wood
wool yacht yak yard yarn yeti yogurt zebra zero zigzag zinc zipper zone
`
  .trim()
  .split(/\s+/);
