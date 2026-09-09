package com.example.builderbot.client.gui;

import com.example.builderbot.build.BuildPlan;
import com.example.builderbot.build.SchematicManager;
import com.example.builderbot.entity.BuilderBotEntity;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Next-Gen Cyber-CAD Blueprint & Bot Interaction Console.
 * Supports individual autonomous control for EACH builder bot (1..10)
 * as well as coordinated swarm fleet operations.
 */
@Environment(EnvType.CLIENT)
public class BuilderBotScreen extends Screen {

    private final net.minecraft.world.entity.Entity bot;
    private String targetBotName;
    private int targetBotId = 1;

    // Execution Scope: false = Target individual bot only; true = Full swarm fleet
    private boolean isFleetMode = false;

    // Schematics list & scrolling
    private List<File> allSchematicFiles = new ArrayList<>();
    private List<File> filteredSchematicFiles = new ArrayList<>();
    private int selectedSchematicIndex = -1;
    private int scrollOffset = 0;
    private static final int VISIBLE_ITEMS = 6;
    private static final int ITEM_HEIGHT = 18;

    // Transformation state
    private int selectedRotation = 0; // 0, 90, 180, 270

    // Fleet bot count state (1 to 10)
    private static int selectedBotCount = 10;

    // Modal state
    private boolean showDespawnModal = false;

    // Inputs & Widgets
    private EditBox searchBox;
    private EditBox structureInput;
    private EditBox coordXBox;
    private EditBox coordYBox;
    private EditBox coordZBox;
    private static String savedCoordX = "";
    private static String savedCoordY = "";
    private static String savedCoordZ = "";
    private final List<Button> activePageWidgets = new ArrayList<>();
    private Button approveDespawnThisBtn;
    private Button approveDespawnAllBtn;
    private Button cancelDespawnBtn;

    // Window Layout Dimensions
    private int winX, winY, winW, winH;
    private int listX, listY, listW, listH;

    public BuilderBotScreen(net.minecraft.world.entity.Entity bot) {
        this(bot, (bot != null && bot.getName() != null) ? bot.getName().getString() : "Builder_Bot");
    }

    public BuilderBotScreen(net.minecraft.world.entity.Entity bot, String targetBotName) {
        super(Component.literal("Builder Bot Control Suite"));
        this.bot = bot;
        this.targetBotName = (targetBotName != null && !targetBotName.isEmpty()) ? targetBotName : "Builder_Bot";
        this.targetBotId = parseBotId(this.targetBotName);

        // Auto-switch all bots to OP and Creative mode immediately on opening
        ensureBotsInCreative();

        // Dynamically fetch live coordinates
        BlockPos dynamicPos = detectTargetPosition();
        if (dynamicPos != null) {
            savedCoordX = String.valueOf(dynamicPos.getX());
            savedCoordY = String.valueOf(dynamicPos.getY());
            savedCoordZ = String.valueOf(dynamicPos.getZ());
        } else if (bot != null) {
            BlockPos botPos = bot.blockPosition();
            savedCoordX = String.valueOf(botPos.getX());
            savedCoordY = String.valueOf(botPos.getY());
            savedCoordZ = String.valueOf(botPos.getZ());
        }
    }

    private static int parseBotId(String name) {
        if (name == null) return 1;
        try {
            String digits = name.replaceAll("\\D+", "");
            if (!digits.isEmpty()) {
                int id = Integer.parseInt(digits);
                if (id >= 1 && id <= 10) return id;
            }
        } catch (Exception ignored) {}
        return 1;
    }

    private String getFormattedBotName(int id) {
        return id == 1 ? "Builder_Bot" : ("Builder_Bot_" + id);
    }

    @Override
    protected void init() {
        if (coordXBox != null && !coordXBox.getValue().trim().isEmpty()) savedCoordX = coordXBox.getValue().trim();
        if (coordYBox != null && !coordYBox.getValue().trim().isEmpty()) savedCoordY = coordYBox.getValue().trim();
        if (coordZBox != null && !coordZBox.getValue().trim().isEmpty()) savedCoordZ = coordZBox.getValue().trim();

        this.clearWidgets();
        activePageWidgets.clear();

        // Expansive, balanced modern window size
        this.winW = 450;
        this.winH = 268;
        this.winX = (this.width - winW) / 2;
        this.winY = (this.height - winH) / 2;

        this.listX = winX + 12;
        this.listY = winY + 76;
        this.listW = 188;
        this.listH = VISIBLE_ITEMS * ITEM_HEIGHT;

        loadSchematics();

        // ── TOP BOT SELECTOR RIBBON: [#1 Main] [#2] [#3] ... [#10] [👥 All Fleet] ─────
        int ribbonY = winY + 26;
        int numPills = 11;
        int pillW = (winW - 24 - (numPills - 1) * 2) / numPills;

        for (int i = 1; i <= 10; i++) {
            final int bId = i;
            boolean isSelected = !isFleetMode && (targetBotId == bId);
            String label = (bId == 1) ? "#1" : ("#" + bId);
            Button botPill = Button.builder(
                    Component.literal(label).withStyle(isSelected ? ChatFormatting.GOLD : ChatFormatting.GRAY),
                    btn -> {
                        this.targetBotId = bId;
                        this.targetBotName = getFormattedBotName(bId);
                        this.isFleetMode = false;
                        this.init();
                    }
            ).bounds(winX + 12 + ((bId - 1) * (pillW + 2)), ribbonY, pillW, 16).build();
            addPageWidget(botPill);
        }

        // Fleet pill at the end of the ribbon
        Button fleetPill = Button.builder(
                Component.literal("👥 Fleet").withStyle(isFleetMode ? ChatFormatting.AQUA : ChatFormatting.DARK_GRAY),
                btn -> {
                    this.isFleetMode = true;
                    this.init();
                }
        ).bounds(winX + 12 + (10 * (pillW + 2)), ribbonY, pillW, 16).build();
        addPageWidget(fleetPill);

        // ── LEFT COLUMN: BLUEPRINT BROWSER ──────────────────────────────────
        this.searchBox = new EditBox(this.font, listX, winY + 52, listW, 16, Component.literal("Search"));
        this.searchBox.setHint(Component.literal("🔍 Search blueprints...").withStyle(ChatFormatting.DARK_GRAY));
        this.searchBox.setMaxLength(64);
        this.searchBox.setResponder(this::filterSchematics);
        this.addRenderableWidget(searchBox);

        Button openFolderBtn = Button.builder(
                Component.literal("📂 Folder"),
                btn -> SchematicManager.openSchematicsFolder()
        ).bounds(listX, listY + listH + 6, (listW / 2) - 2, 16).build();
        addPageWidget(openFolderBtn);

        Button refreshBtn = Button.builder(
                Component.literal("🔄 Reload"),
                btn -> { loadSchematics(); this.scrollOffset = 0; }
        ).bounds(listX + (listW / 2) + 2, listY + listH + 6, (listW / 2) - 2, 16).build();
        addPageWidget(refreshBtn);

        // ── RIGHT COLUMN: TARGETING & DISPATCH MATRIX ────────────────────────
        int rightX = winX + 210;
        int rightY = winY + 52;
        int rightW = winW - 222;

        // 1. Coordinates Inputs: [X] [Y] [Z]
        int boxW = (rightW - 6) / 3;
        this.coordXBox = new EditBox(this.font, rightX, rightY + 14, boxW, 16, Component.literal("X"));
        this.coordXBox.setHint(Component.literal("X").withStyle(ChatFormatting.DARK_GRAY));
        this.coordXBox.setValue(savedCoordX);
        this.coordXBox.setResponder(val -> savedCoordX = val);
        this.addRenderableWidget(coordXBox);

        this.coordYBox = new EditBox(this.font, rightX + boxW + 3, rightY + 14, boxW, 16, Component.literal("Y"));
        this.coordYBox.setHint(Component.literal("Y").withStyle(ChatFormatting.DARK_GRAY));
        this.coordYBox.setValue(savedCoordY);
        this.coordYBox.setResponder(val -> savedCoordY = val);
        this.addRenderableWidget(coordYBox);

        this.coordZBox = new EditBox(this.font, rightX + (boxW * 2) + 6, rightY + 14, boxW, 16, Component.literal("Z"));
        this.coordZBox.setHint(Component.literal("Z").withStyle(ChatFormatting.DARK_GRAY));
        this.coordZBox.setValue(savedCoordZ);
        this.coordZBox.setResponder(val -> savedCoordZ = val);
        this.addRenderableWidget(coordZBox);

        // 2. Position Auto-Snap Chips: [ 🎯 Target ] [ 🧍 Player ] [ 🤖 Bot ]
        int chipW = (rightW - 6) / 3;
        Button crosshairBtn = Button.builder(
                Component.literal("🎯 Target").withStyle(ChatFormatting.GREEN),
                btn -> fillTargetPosition()
        ).bounds(rightX, rightY + 34, chipW, 16).build();
        addPageWidget(crosshairBtn);

        Button myPosBtn = Button.builder(
                Component.literal("📍 Player").withStyle(ChatFormatting.AQUA),
                btn -> fillMyPosition()
        ).bounds(rightX + chipW + 3, rightY + 34, chipW, 16).build();
        addPageWidget(myPosBtn);

        Button botPosBtn = Button.builder(
                Component.literal("🤖 Bot").withStyle(ChatFormatting.YELLOW),
                btn -> fillTargetBotPosition()
        ).bounds(rightX + (chipW * 2) + 6, rightY + 34, chipW, 16).build();
        addPageWidget(botPosBtn);

        // 3. Compass Orientation: [ 0° N ] [ 90° E ] [ 180° S ] [ 270° W ]
        int rotW = (rightW - 6) / 4;
        String[] rotLabels = { "0° N", "90° E", "180° S", "270° W" };
        for (int i = 0; i < 4; i++) {
            final int deg = i * 90;
            boolean isSelected = (selectedRotation == deg);
            Button rotBtn = Button.builder(
                    Component.literal(rotLabels[i]).withStyle(isSelected ? ChatFormatting.GOLD : ChatFormatting.WHITE),
                    btn -> { this.selectedRotation = deg; this.init(); }
            ).bounds(rightX + (i * (rotW + 2)), rightY + 66, rotW, 16).build();
            addPageWidget(rotBtn);
        }

        // 4. Execution Scope & Workforce Stepper
        if (!isFleetMode) {
            // Solo Mode: Button to toggle to Fleet mode
            Button scopeToggleBtn = Button.builder(
                    Component.literal("🎯 Target: " + targetBotName + " (Solo)").withStyle(ChatFormatting.YELLOW),
                    btn -> { this.isFleetMode = true; this.init(); }
            ).bounds(rightX, rightY + 98, rightW, 16).build();
            addPageWidget(scopeToggleBtn);
        } else {
            // Fleet Mode: Workforce Stepper
            initWorkforceStepper(rightX, rightY + 98, rightW);
        }

        // 5. 3D Ghost Blueprint Hologram Toggle
        boolean hasGhost = com.example.builderbot.client.render.ClientGhostRenderer.hasActiveGhost();
        Component previewLabel = hasGhost
                ? Component.literal("❌ Clear 3D Ghost Hologram").withStyle(ChatFormatting.RED, ChatFormatting.BOLD)
                : Component.literal("🔮 Preview 3D Ghost Hologram").withStyle(ChatFormatting.AQUA, ChatFormatting.BOLD);

        Button previewBtn = Button.builder(
                previewLabel,
                btn -> onPreviewSchematic()
        ).bounds(rightX, rightY + 118, rightW, 16).build();
        addPageWidget(previewBtn);

        // 6. PROMINENT PRIMARY ACTION BUTTON
        String launchText = isFleetMode
                ? ("🚀 LAUNCH SWARM BUILD (" + selectedBotCount + " BOTS)")
                : ("🚀 START BUILD WITH " + targetBotName.toUpperCase());

        Button launchBuildBtn = Button.builder(
                Component.literal(launchText).withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD),
                btn -> onBuildSelectedSchematic()
        ).bounds(rightX, rightY + 138, rightW, 20).build();
        addPageWidget(launchBuildBtn);

        // 7. Individual Tactical Row: [ 📍 Recall ] [ 🕊 Flight ] [ ⏪ Undo ] [ ⏹ Stop ]
        int actW = (rightW - 6) / 4;
        Button recallBtn = Button.builder(
                Component.literal("📍 Come").withStyle(ChatFormatting.AQUA),
                btn -> {
                    if (isFleetMode) {
                        runCommand("builderbot tp");
                    } else {
                        runCommand("builderbot bot " + targetBotName + " come");
                    }
                }
        ).bounds(rightX, rightY + 162, actW, 16).build();
        addPageWidget(recallBtn);

        Button flyBtn = Button.builder(
                Component.literal("🕊 Fly").withStyle(ChatFormatting.GREEN),
                btn -> {
                    if (isFleetMode) {
                        runCommand("builderbot fly");
                    } else {
                        runCommand("builderbot bot " + targetBotName + " fly");
                    }
                }
        ).bounds(rightX + (actW + 2), rightY + 162, actW, 16).build();
        addPageWidget(flyBtn);

        Button undoBtn = Button.builder(
                Component.literal("⏪ Undo").withStyle(ChatFormatting.YELLOW),
                btn -> {
                    if (isFleetMode) {
                        runCommand("builderbot undo");
                    } else {
                        runCommand("builderbot bot " + targetBotName + " undo");
                    }
                    this.onClose();
                }
        ).bounds(rightX + ((actW + 2) * 2), rightY + 162, actW, 16).build();
        addPageWidget(undoBtn);

        Button stopBtn = Button.builder(
                Component.literal("⏹ Stop").withStyle(ChatFormatting.RED, ChatFormatting.BOLD),
                btn -> {
                    if (isFleetMode) {
                        runCommand("builderbot stopall");
                    } else {
                        runCommand("builderbot bot " + targetBotName + " stop");
                    }
                    this.onClose();
                }
        ).bounds(rightX + ((actW + 2) * 3), rightY + 162, actW, 16).build();
        addPageWidget(stopBtn);

        // 8. Manual Structure ID Bar
        this.structureInput = new EditBox(this.font, rightX, rightY + 184, rightW - 46, 16, Component.literal("ID"));
        this.structureInput.setHint(Component.literal("Structure ID or Shape...").withStyle(ChatFormatting.DARK_GRAY));
        this.addRenderableWidget(structureInput);

        Button manualBuildBtn = Button.builder(
                Component.literal("Build").withStyle(ChatFormatting.GREEN),
                btn -> onManualBuild()
        ).bounds(rightX + rightW - 42, rightY + 184, 42, 16).build();
        addPageWidget(manualBuildBtn);

        // 9. Bottom Bar: OP Reinforce, Despawn, Close
        Button reopBtn = Button.builder(
                Component.literal("👑 Re-Op").withStyle(ChatFormatting.GOLD),
                btn -> {
                    ensureBotsInCreative();
                    runCommand("builderbot op");
                }
        ).bounds(listX, winY + winH - 22, 54, 16).build();
        addPageWidget(reopBtn);

        Button despawnBtn = Button.builder(
                Component.literal("💨 Despawn").withStyle(ChatFormatting.DARK_RED),
                btn -> setDespawnModalVisible(true)
        ).bounds(listX + 58, winY + winH - 22, 64, 16).build();
        addPageWidget(despawnBtn);

        Button closeBtn = Button.builder(
                Component.literal("✖ Close").withStyle(ChatFormatting.WHITE),
                btn -> this.onClose()
        ).bounds(winX + winW - 64, winY + winH - 22, 52, 16).build();
        addPageWidget(closeBtn);

        // ── DESPAWN CONFIRMATION MODAL BUTTONS ────────────────────────────────
        int modalW = 290;
        int modalH = 120;
        int modalX = (this.width - modalW) / 2;
        int modalY = (this.height - modalH) / 2;

        this.approveDespawnThisBtn = Button.builder(
                Component.literal("💨 Despawn " + targetBotName).withStyle(ChatFormatting.RED),
                btn -> {
                    runCommand("builderbot bot " + targetBotName + " despawn");
                    this.onClose();
                }
        ).bounds(modalX + 12, modalY + 62, (modalW / 2) - 16, 22).build();

        this.approveDespawnAllBtn = Button.builder(
                Component.literal("💥 Despawn ALL").withStyle(ChatFormatting.DARK_RED, ChatFormatting.BOLD),
                btn -> {
                    runCommand("builderbot despawnall");
                    this.onClose();
                }
        ).bounds(modalX + (modalW / 2) + 4, modalY + 62, (modalW / 2) - 16, 22).build();

        this.cancelDespawnBtn = Button.builder(
                Component.literal("✖ Cancel (Keep Fleet)").withStyle(ChatFormatting.GREEN),
                btn -> setDespawnModalVisible(false)
        ).bounds(modalX + 12, modalY + 88, modalW - 24, 20).build();

        this.approveDespawnThisBtn.visible = false;
        this.approveDespawnAllBtn.visible = false;
        this.cancelDespawnBtn.visible = false;
        this.addRenderableWidget(this.approveDespawnThisBtn);
        this.addRenderableWidget(this.approveDespawnAllBtn);
        this.addRenderableWidget(this.cancelDespawnBtn);
    }

    private void addPageWidget(Button button) {
        activePageWidgets.add(button);
        this.addRenderableWidget(button);
    }

    private void initWorkforceStepper(int x, int y, int width) {
        Button decBotBtn = Button.builder(
                Component.literal("-").withStyle(ChatFormatting.RED, ChatFormatting.BOLD),
                btn -> { if (selectedBotCount > 1) { selectedBotCount--; this.init(); } }
        ).bounds(x, y, 20, 16).build();
        addPageWidget(decBotBtn);

        String botDesc = selectedBotCount == 1 ? "1 Bot (Solo)" : selectedBotCount + " Bots (Swarm)";
        Button botCountDisplay = Button.builder(
                Component.literal("👥 " + botDesc).withStyle(ChatFormatting.YELLOW),
                btn -> { this.isFleetMode = false; this.init(); }
        ).bounds(x + 22, y, width - 44, 16).build();
        addPageWidget(botCountDisplay);

        Button incBotBtn = Button.builder(
                Component.literal("+").withStyle(ChatFormatting.GREEN, ChatFormatting.BOLD),
                btn -> { if (selectedBotCount < 10) { selectedBotCount++; this.init(); } }
        ).bounds(x + width - 20, y, 20, 16).build();
        addPageWidget(incBotBtn);
    }

    public static BlockPos detectTargetPosition() {
        Minecraft mc = Minecraft.getInstance();
        if (mc.hitResult instanceof BlockHitResult blockHit && blockHit.getType() == HitResult.Type.BLOCK) {
            return blockHit.getBlockPos().relative(blockHit.getDirection());
        }
        if (mc.player != null) {
            return mc.player.blockPosition();
        }
        return null;
    }

    private void fillTargetPosition() {
        BlockPos pos = detectTargetPosition();
        if (pos != null) {
            savedCoordX = String.valueOf(pos.getX());
            savedCoordY = String.valueOf(pos.getY());
            savedCoordZ = String.valueOf(pos.getZ());
            if (coordXBox != null) coordXBox.setValue(savedCoordX);
            if (coordYBox != null) coordYBox.setValue(savedCoordY);
            if (coordZBox != null) coordZBox.setValue(savedCoordZ);
        }
    }

    private void fillMyPosition() {
        if (Minecraft.getInstance().player != null) {
            BlockPos pos = Minecraft.getInstance().player.blockPosition();
            savedCoordX = String.valueOf(pos.getX());
            savedCoordY = String.valueOf(pos.getY());
            savedCoordZ = String.valueOf(pos.getZ());
            if (coordXBox != null) coordXBox.setValue(savedCoordX);
            if (coordYBox != null) coordYBox.setValue(savedCoordY);
            if (coordZBox != null) coordZBox.setValue(savedCoordZ);
        }
    }

    private void fillTargetBotPosition() {
        BlockPos pos = null;
        if (Minecraft.getInstance().level != null) {
            var botOpt = Minecraft.getInstance().level.players().stream()
                    .filter(p -> p.getName().getString().equalsIgnoreCase(this.targetBotName) ||
                                 p.getName().getString().toLowerCase().contains(this.targetBotName.toLowerCase()))
                    .findFirst();
            if (botOpt.isPresent()) {
                pos = botOpt.get().blockPosition();
            }
        }
        if (pos == null && this.bot != null) {
            pos = this.bot.blockPosition();
        }
        if (pos != null) {
            savedCoordX = String.valueOf(pos.getX());
            savedCoordY = String.valueOf(pos.getY());
            savedCoordZ = String.valueOf(pos.getZ());
            if (coordXBox != null) coordXBox.setValue(savedCoordX);
            if (coordYBox != null) coordYBox.setValue(savedCoordY);
            if (coordZBox != null) coordZBox.setValue(savedCoordZ);
        } else {
            fillMyPosition();
        }
    }

    public BlockPos getTargetOrigin() {
        String xs = coordXBox != null ? coordXBox.getValue().trim() : savedCoordX.trim();
        String ys = coordYBox != null ? coordYBox.getValue().trim() : savedCoordY.trim();
        String zs = coordZBox != null ? coordZBox.getValue().trim() : savedCoordZ.trim();
        if (!xs.isEmpty() && !ys.isEmpty() && !zs.isEmpty()) {
            try {
                int x = (int) Math.floor(Double.parseDouble(xs.replace(",", "")));
                int y = (int) Math.floor(Double.parseDouble(ys.replace(",", "")));
                int z = (int) Math.floor(Double.parseDouble(zs.replace(",", "")));
                return new BlockPos(x, y, z);
            } catch (NumberFormatException ignored) {}
        }
        return null;
    }

    private String buildCoordArgsString() {
        BlockPos origin = getTargetOrigin();
        if (origin != null) {
            return " " + origin.getX() + " " + origin.getY() + " " + origin.getZ() + " " + selectedRotation;
        }
        return selectedRotation > 0 ? " " + selectedRotation : "";
    }

    private void loadSchematics() {
        this.allSchematicFiles = SchematicManager.listSchematics();
        filterSchematics(searchBox != null ? searchBox.getValue() : "");
        if (selectedSchematicIndex < 0 && !filteredSchematicFiles.isEmpty()) {
            selectedSchematicIndex = 0;
        }
    }

    private void filterSchematics(String query) {
        String filter = query.toLowerCase().trim();
        if (filter.isEmpty()) {
            this.filteredSchematicFiles = new ArrayList<>(allSchematicFiles);
        } else {
            this.filteredSchematicFiles = allSchematicFiles.stream()
                    .filter(f -> f.getName().toLowerCase().contains(filter))
                    .toList();
        }

        if (selectedSchematicIndex >= filteredSchematicFiles.size()) {
            selectedSchematicIndex = filteredSchematicFiles.isEmpty() ? -1 : 0;
        }
        if (selectedSchematicIndex < 0 && !filteredSchematicFiles.isEmpty()) {
            selectedSchematicIndex = 0;
        }
        clampScroll();
    }

    private void scrollBy(int delta) {
        this.scrollOffset += delta;
        clampScroll();
    }

    private void clampScroll() {
        int maxScroll = Math.max(0, filteredSchematicFiles.size() - VISIBLE_ITEMS);
        if (scrollOffset > maxScroll) scrollOffset = maxScroll;
        if (scrollOffset < 0) scrollOffset = 0;
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        if (!showDespawnModal) {
            if (mouseX >= listX && mouseX <= listX + listW && mouseY >= listY && mouseY <= listY + listH) {
                if (scrollY > 0) scrollBy(-1);
                else if (scrollY < 0) scrollBy(1);
                return true;
            }
        }
        return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        if (!showDespawnModal) {
            double mx = event.x();
            double my = event.y();

            if (mx >= listX && mx <= listX + listW && my >= listY && my <= listY + listH) {
                int rowClicked = (int) ((my - listY) / ITEM_HEIGHT);
                int clickedIndex = scrollOffset + rowClicked;
                if (clickedIndex >= 0 && clickedIndex < filteredSchematicFiles.size()) {
                    this.selectedSchematicIndex = clickedIndex;
                    if (doubleClick) {
                        onBuildSelectedSchematic();
                    }
                    return true;
                }
            }
        }
        return super.mouseClicked(event, doubleClick);
    }

    private void setDespawnModalVisible(boolean visible) {
        this.showDespawnModal = visible;
        this.approveDespawnThisBtn.visible = visible;
        this.approveDespawnAllBtn.visible = visible;
        this.cancelDespawnBtn.visible = visible;
        this.approveDespawnThisBtn.active = visible;
        this.approveDespawnAllBtn.active = visible;
        this.cancelDespawnBtn.active = visible;

        for (Button btn : activePageWidgets) btn.active = !visible;
        if (structureInput != null) structureInput.setEditable(!visible);
        if (searchBox != null) searchBox.setEditable(!visible);
    }

    private static boolean isBotPlayer(String playerName) {
        if (playerName == null) return false;
        String clean = playerName.replace("_", "").toLowerCase();
        return clean.startsWith("builderbot");
    }

    public static void ensureBotsInCreative() {
        var conn = Minecraft.getInstance().getConnection();
        if (conn != null && conn.getOnlinePlayers() != null) {
            for (var info : conn.getOnlinePlayers()) {
                if (info != null && info.getProfile() != null && isBotPlayer(info.getProfile().name())) {
                    String botName = info.getProfile().name();
                    conn.sendCommand("op " + botName);
                    conn.sendCommand("gamemode creative " + botName);
                }
            }
        }
    }

    private void sendOpPrepCommands(BlockPos origin) {
        var conn = Minecraft.getInstance().getConnection();
        if (conn != null && conn.getOnlinePlayers() != null) {
            ensureBotsInCreative();

            if (origin != null) {
                if (isFleetMode) {
                    for (var info : conn.getOnlinePlayers()) {
                        if (info != null && info.getProfile() != null && isBotPlayer(info.getProfile().name())) {
                            String botName = info.getProfile().name();
                            conn.sendCommand("op " + botName);
                            conn.sendCommand("gamemode creative " + botName);
                            conn.sendCommand("tp " + botName + " " + origin.getX() + " " + (origin.getY() + 1) + " " + origin.getZ());
                        }
                    }
                } else {
                    conn.sendCommand("op " + targetBotName);
                    conn.sendCommand("gamemode creative " + targetBotName);
                    conn.sendCommand("tp " + targetBotName + " " + origin.getX() + " " + (origin.getY() + 1) + " " + origin.getZ());
                }
            }
        }
    }

    private void onBuildSelectedSchematic() {
        com.example.builderbot.client.render.ClientGhostRenderer.clearGhostSchematic();
        if (selectedSchematicIndex < 0 || selectedSchematicIndex >= filteredSchematicFiles.size()) {
            if (Minecraft.getInstance().player != null) {
                Minecraft.getInstance().player.sendSystemMessage(
                    Component.literal("§c[BuilderBot] Please select a schematic from the library first!"));
            }
            return;
        }
        File selected = filteredSchematicFiles.get(selectedSchematicIndex);
        BlockPos origin = getTargetOrigin();
        if (origin == null) {
            if (Minecraft.getInstance().player != null) {
                Minecraft.getInstance().player.sendSystemMessage(
                    Component.literal("§c[BuilderBot] Please enter valid X, Y, Z coordinates before building!"));
            }
            return;
        }
        sendOpPrepCommands(origin);
        String coordArgs = buildCoordArgsString();

        if (isFleetMode) {
            runCommand("builderbot swarm " + selectedBotCount + " schematic " + selected.getName() + coordArgs);
        } else {
            runCommand("builderbot bot " + targetBotName + " schematic " + selected.getName() + coordArgs);
        }
        this.onClose();
    }

    private void onPreviewSchematic() {
        if (com.example.builderbot.client.render.ClientGhostRenderer.hasActiveGhost()) {
            com.example.builderbot.client.render.ClientGhostRenderer.clearGhostSchematic();
            this.init();
            return;
        }

        if (selectedSchematicIndex < 0 || selectedSchematicIndex >= filteredSchematicFiles.size()) {
            if (Minecraft.getInstance().player != null) {
                Minecraft.getInstance().player.sendSystemMessage(
                    Component.literal("§c[BuilderBot] Please select a schematic from the list first to preview!"));
            }
            return;
        }
        File selected = filteredSchematicFiles.get(selectedSchematicIndex);
        BlockPos origin = getTargetOrigin();
        if (origin == null) {
            if (Minecraft.getInstance().player != null) {
                Minecraft.getInstance().player.sendSystemMessage(
                    Component.literal("§c[BuilderBot] Please enter valid X, Y, Z coordinates before previewing!"));
            }
            return;
        }
        com.example.builderbot.client.render.ClientGhostRenderer.showGhostSchematic(
                selected.getName(), origin, selectedRotation);
        this.onClose();
    }

    private void onManualBuild() {
        com.example.builderbot.client.render.ClientGhostRenderer.clearGhostSchematic();
        String query = structureInput.getValue().trim();
        if (!query.isEmpty()) {
            BlockPos origin = getTargetOrigin();
            if (origin == null) {
                if (Minecraft.getInstance().player != null) {
                    Minecraft.getInstance().player.sendSystemMessage(
                        Component.literal("§c[BuilderBot] Please enter valid X, Y, Z coordinates before building!"));
                }
                return;
            }
            sendOpPrepCommands(origin);
            String coordArgs = buildCoordArgsString();

            if (isFleetMode) {
                if (query.endsWith(".litematic") || query.endsWith(".nbt")) {
                    runCommand("builderbot swarm " + selectedBotCount + " schematic " + query + coordArgs);
                } else {
                    runCommand("builderbot swarm " + selectedBotCount + " build " + query + coordArgs);
                }
            } else {
                runCommand("builderbot bot " + targetBotName + " schematic " + query + coordArgs);
            }
            this.onClose();
        }
    }

    private void runCommand(String command) {
        if (Minecraft.getInstance().player != null && Minecraft.getInstance().player.connection != null) {
            var conn = Minecraft.getInstance().player.connection;

            // Direct in-game bot chat routing
            if (command.startsWith("builderbot bot ")) {
                String sub = command.substring("builderbot bot ".length()).trim();
                conn.sendChat("!bot " + sub);
            } else if (command.equals("builderbot op")) {
                conn.sendChat("!op");
            } else if (command.equals("builderbot undo")) {
                conn.sendChat("!undo");
            } else if (command.equals("builderbot stop") || command.equals("builderbot stopall")) {
                conn.sendChat("!stop");
                conn.sendChat("!stopall");
                conn.sendCommand("builderbot stopall");
            } else if (command.equals("builderbot tp")) {
                conn.sendChat("!come");
            } else if (command.equals("builderbot fly")) {
                conn.sendChat("!fly");
            } else if (command.startsWith("builderbot cleararea")) {
                String args = command.substring("builderbot cleararea".length()).trim();
                conn.sendChat("!cleararea " + args);
            } else if (command.equals("builderbot despawnall")) {
                conn.sendChat("!despawnall");
            } else if (command.equals("builderbot despawn")) {
                conn.sendChat("!despawn");
            } else if (command.contains("schematic ")) {
                String name = command.substring(command.indexOf("schematic ") + "schematic ".length()).trim();
                if (command.contains("swarm ") && selectedBotCount > 1) {
                    conn.sendChat("!schematic swarm " + selectedBotCount + " " + name);
                } else {
                    conn.sendChat("!schematic " + name);
                }
            } else if (command.contains(" build ")) {
                String name = command.substring(command.indexOf(" build ") + " build ".length()).trim();
                if (command.contains("swarm ") && selectedBotCount > 1) {
                    conn.sendChat("!schematic swarm " + selectedBotCount + " " + name);
                } else {
                    conn.sendChat("!schematic " + name);
                }
            }

            if (Minecraft.getInstance().hasSingleplayerServer() && !command.equals("builderbot stopall") && !command.equals("builderbot stop")) {
                conn.sendCommand(command);
            }
        }
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor guiGraphics, int mouseX, int mouseY, float delta) {
        // 1. Translucent dark vignette background
        guiGraphics.fill(0, 0, this.width, this.height, 0x88000000);

        // 2. High-Tech Cyber-Deck Outer Glowing Border
        guiGraphics.fill(winX - 2, winY - 2, winX + winW + 2, winY + winH + 2, 0xFF0284C7);
        guiGraphics.fill(winX - 1, winY - 1, winX + winW + 1, winY + winH + 1, 0xFF0F172A);

        // 3. Deep Obsidian Slate Glassmorphic Body
        guiGraphics.fill(winX, winY, winX + winW, winY + winH, 0xF8090E17);

        // 4. Top Header Bar
        guiGraphics.fill(winX + 8, winY + 22, winX + winW - 8, winY + 23, 0xFF1E293B);

        String botHeader = isFleetMode
                ? "👥 SWARM FLEET COMMAND // ALL BOTS"
                : ("🤖 " + targetBotName.toUpperCase() + " // MISSION CONTROL");

        guiGraphics.text(this.font, botHeader, winX + 12, winY + 8, 0xFF38BDF8);

        // Live Status Badge
        if (com.example.builderbot.client.BuilderBotClient.liveBuildStatus != null &&
            (System.currentTimeMillis() - com.example.builderbot.client.BuilderBotClient.lastStatusUpdate < 60000)) {
            guiGraphics.text(this.font, com.example.builderbot.client.BuilderBotClient.liveBuildStatus, winX + winW - 170, winY + 8, 0xFFFBBF24);
        } else {
            String status = isFleetMode ? ("🟢 Fleet Ready (" + selectedBotCount + " Bots)") : "🟢 Online | 👑 OP";
            guiGraphics.text(this.font, status, winX + winW - 145, winY + 8, 0xFF4ADE80);
        }

        // Section Headers
        int rightX = winX + 210;
        int rightY = winY + 52;
        int rightW = winW - 222;

        guiGraphics.text(this.font, "📍 Origin (X Y Z)", rightX, rightY + 2, 0xFFFBBF24);
        guiGraphics.text(this.font, "🧭 Orientation", rightX, rightY + 54, 0xFFFBBF24);
        guiGraphics.text(this.font, "⚡ Execution Scope", rightX, rightY + 86, 0xFFFBBF24);

        // Left List Box Frame & Slate Fill
        guiGraphics.fill(listX - 1, listY - 1, listX + listW + 1, listY + listH + 1, 0xFF1E293B);
        guiGraphics.fill(listX, listY, listX + listW, listY + listH, 0xDD0F172A);

        if (filteredSchematicFiles.isEmpty()) {
            guiGraphics.centeredText(this.font, "No schematics found", listX + (listW / 2), listY + 38, 0xFF64748B);
            guiGraphics.centeredText(this.font, "Click [Folder] to add", listX + (listW / 2), listY + 54, 0xFF475569);
        } else {
            int displayCount = Math.min(VISIBLE_ITEMS, filteredSchematicFiles.size() - scrollOffset);
            for (int i = 0; i < displayCount; i++) {
                int itemIdx = scrollOffset + i;
                File file = filteredSchematicFiles.get(itemIdx);
                int itemTop = listY + (i * ITEM_HEIGHT);
                boolean isSelected = (itemIdx == selectedSchematicIndex);
                boolean isHovered = (mouseX >= listX && mouseX <= listX + listW - 6 && mouseY >= itemTop && mouseY < itemTop + ITEM_HEIGHT);

                if (isSelected) {
                    guiGraphics.fill(listX + 1, itemTop + 1, listX + listW - 7, itemTop + ITEM_HEIGHT - 1, 0xFF0369A1);
                    guiGraphics.fill(listX + 1, itemTop + 1, listX + 4, itemTop + ITEM_HEIGHT - 1, 0xFF38BDF8);
                } else if (isHovered) {
                    guiGraphics.fill(listX + 1, itemTop + 1, listX + listW - 7, itemTop + ITEM_HEIGHT - 1, 0xFF1E293B);
                }

                String name = file.getName();
                String icon = name.endsWith(".litematic") ? "📜 " : (name.endsWith(".nbt") ? "🧊 " : "📐 ");
                if (name.length() > 22) name = name.substring(0, 19) + "...";
                int textColor = isSelected ? 0xFFFFFFFF : (name.endsWith(".litematic") ? 0xFF38BDF8 : 0xFFA78BFA);
                guiGraphics.text(this.font, icon + name, listX + 6, itemTop + 5, textColor);
            }

            // Scrollbar
            int scrollbarX = listX + listW - 5;
            guiGraphics.fill(scrollbarX, listY, scrollbarX + 4, listY + listH, 0xFF1E293B);
            int totalItems = filteredSchematicFiles.size();
            if (totalItems > VISIBLE_ITEMS) {
                int thumbH = Math.max(12, (VISIBLE_ITEMS * listH) / totalItems);
                int maxScroll = totalItems - VISIBLE_ITEMS;
                int thumbY = listY + ((scrollOffset * (listH - thumbH)) / maxScroll);
                guiGraphics.fill(scrollbarX, thumbY, scrollbarX + 4, thumbY + thumbH, 0xFF0284C7);
            }
        }

        super.extractRenderState(guiGraphics, mouseX, mouseY, delta);

        // Despawn Confirmation Modal
        if (showDespawnModal) {
            guiGraphics.fill(0, 0, this.width, this.height, 0xDD000000);
            int modalW = 290;
            int modalH = 120;
            int modalX = (this.width - modalW) / 2;
            int modalY = (this.height - modalH) / 2;

            guiGraphics.fill(modalX - 1, modalY - 1, modalX + modalW + 1, modalY + modalH + 1, 0xFFEF4444);
            guiGraphics.fill(modalX, modalY, modalX + modalW, modalY + modalH, 0xFA18181B);

            guiGraphics.centeredText(this.font, "⚠ CONFIRM DESPAWN", modalX + (modalW / 2), modalY + 12, 0xFFEF4444);
            guiGraphics.centeredText(this.font, "Choose which bots to remove:", modalX + (modalW / 2), modalY + 30, 0xFFF4F4F5);
            guiGraphics.centeredText(this.font, "Active tasks will be cancelled.", modalX + (modalW / 2), modalY + 44, 0xFFA1A1AA);

            this.approveDespawnThisBtn.extractRenderState(guiGraphics, mouseX, mouseY, delta);
            this.approveDespawnAllBtn.extractRenderState(guiGraphics, mouseX, mouseY, delta);
            this.cancelDespawnBtn.extractRenderState(guiGraphics, mouseX, mouseY, delta);
        }
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
