/* The register class tables of the C VSC model emu's VSC device was ported from (the model itself is not in this
 * tree), kept as the fixture of check_display's and test_dev's model_classes. */
static const struct { uint16_t first, last; uint8_t cls; } reg_class[] = {
    { 0x00C, 0x010, RC_MODEL },   /* INTEN1, INTST1 */
    { 0x014, 0x018, RC_STORED },  /* INTEN2, INTST2 */
    { 0x030, 0x038, RC_STORED },  /* VLSYNC, VLRST1, VLRST2 */
    { 0x05C, 0x05C, RC_STORED },  /* GAMTAEN */
    { 0x060, 0x060, RC_MODEL },   /* DMAEN */
    { 0x068, 0x068, RC_STORED },  /* VLRST3 */
    { 0x084, 0x33C, RC_STORED },  /* IMG1-3/OSD1-3 DMASET2-16 */
    { 0x368, 0x38C, RC_STORED },  /* DMADDCSET1-6, IMG1-3DMAODR, OSDDMAODR */
    { 0x390, 0x3DC, RC_MODEL },   /* DMASADR, DMALD, DMABN x6, IMGDMASPOS, OSDDMASPOS */
    { 0x400, 0x410, RC_MODEL },   /* IMG1-3FMT, OSDFMT1, OSDFMT2 */
    { 0x420, 0x424, RC_MODEL },   /* VIDEOAREA1/2 */
    { 0x42C, 0x430, RC_MODEL }, { 0x438, 0x43C, RC_MODEL }, { 0x444, 0x448, RC_MODEL },  /* IMGnAREA1/2 */
    { 0x450, 0x454, RC_MODEL }, { 0x45C, 0x460, RC_MODEL }, { 0x468, 0x46C, RC_MODEL },  /* OSDnAREA1/2 */
    { 0x4C0, 0x4C8, RC_MODEL },   /* OSDRESO, IMG2BC, IMG3BC */
    { 0x4D0, 0x4E0, RC_MODEL },   /* O1BC-O3BC, OSDCP2 */
    { 0x4F0, 0x578, RC_MODEL },   /* IMG1-3RSZ*, OSD1-3RSZ* */
    { 0x5E0, 0x5E0, RC_MODEL },   /* PEAK1 */
    { 0x618, 0x63C, RC_MODEL },   /* MIXODR1/2, PLANC x6, OSDMIX, BG */
    { 0x660, 0x6D8, RC_STORED },  /* YGAIN, KNEE1-13, ROT1-4, RGBCNV, CRM1-7, GAM1, YCCNV, SETUP, YCCLIP1 */
    { 0x6E4, 0x6F8, RC_STORED },  /* YCLPF, TVTFT17, TFTOUT1, PORT, HDMI1/2 */
    { 0x720, 0x720, RC_MODEL },   /* SYNC1 */
    { 0x724, 0x724, RC_STORED },  /* CYCLE1 */
    { 0x728, 0x728, RC_MODEL },   /* SYNC2 */
    { 0x72C, 0x72C, RC_STORED },  /* SYNC3 */
    { 0x730, 0x730, RC_MODEL },   /* SYNC4 */
    { 0x734, 0x73C, RC_STORED },  /* SYNC5, SYNC6, LINECNT1 */
    { 0xE80, 0xE80, RC_MODEL },   /* MONI3 */
};

static const struct { uint16_t off; uint32_t v1, v2; } features[] = {   /* channel 1 (EVF), 2 (TFT); ascending */
    { 0x004, 0x1C0, 0x1C0 }, { 0x008, 1, 1 },  /* CTRL2, CTRL3 */
    { 0x03C, 0x4000, 0x4000 }, { 0x044, 0x4000, 0x4000 },  /* SRAM1, SRAM3 */
    { 0x428, 0x29, 0x08 },  /* VIDEOAREA3 */
    { 0x580, 0x2E, 0x2E }, { 0x584, 0x2E, 0x2E }, { 0x588, 0x2E, 0x2E },  /* IMG1-3HDLY */
    { 0x58C, 0x2E, 0x2E }, { 0x590, 0x30, 0x30 }, { 0x594, 0x32, 0x32 },  /* OSD1-3HDLY */
    { 0x598, 0x2E, 0x2E },  /* MIXHDLY */
    { 0x5A0, 0x100, 0x100 },  /* IMG1LPF */
    { 0x5A8, 0x100, 0x100 }, { 0x5AC, 0x100, 0x100 }, { 0x5B0, 0x100, 0x100 }, { 0x5B4, 0x100, 0x100 },  /* LPF3-6 */
};
