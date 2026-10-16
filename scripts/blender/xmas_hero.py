"""
The red house and the room inside it, shared by xmas_town.py and xmas_room.py so the two fit:
the room stands inside the house, its window wall against the front wall (the window in the one
is the window in the other) and its flue going straight up into the chimney on the roof. You can
go down the chimney into the room, and out of its window into the square, without a cut.

Blender axes and metres. The room is built in its own frame (x right, y into the room, the
window wall at y = BACK) and turned half round into the town's, where the house sits at the
origin with its front to the square (-y).
"""

import math

# ---- The room, in its own frame (xmas_room.py builds it to these) ----

ROOM_W, ROOM_BACK, ROOM_H, ROOM_FRONT = 4.6, 2.0, 3.1, -1.2
WIN_X, WIN_W, WIN_Z, WIN_H = -1.6, 0.86, 1.0, 1.32
FIRE_X = -0.3
FLUE_X, FLUE_Y, FLUE_W, FLUE_D = FIRE_X, ROOM_BACK - 0.17, 0.5, 0.22

# ---- The house, in the town's frame ----

HOUSE_W, HOUSE_D, HOUSE_H = 7.2, 5.6, 6.2
WALL = 0.28
PITCH = 1.15

# The room turned half round, its window wall just inside the front wall
ROOM_TURN = math.pi
ROOM_AT = (0.0, -(HOUSE_D / 2 - WALL - 0.02) + ROOM_BACK, 0.42)


def room_to_town(p):
    """A point in the room's frame to the town's"""
    c, s = math.cos(ROOM_TURN), math.sin(ROOM_TURN)
    return (c * p[0] - s * p[1] + ROOM_AT[0], s * p[0] + c * p[1] + ROOM_AT[1], p[2] + ROOM_AT[2])


# The chimney stands right over the flue
CHIMNEY_XY = room_to_town((FLUE_X, FLUE_Y, 0))[:2]


def roof_z(y):
    """The roof's height over a point y across the house (the ridge runs along x)"""
    half = HOUSE_D / 2 + 0.45
    return HOUSE_H + (half - abs(y)) / half * (HOUSE_D / 2 * PITCH + 0.3)


# How high the chimney stands out of the roof
CHIMNEY_TOP = roof_z(CHIMNEY_XY[1]) + 1.7
# The flue, up to there, in the room's frame
FLUE_TOP = CHIMNEY_TOP - ROOM_AT[2] - 0.12
# The window, in the town's frame: its middle on the front wall
WINDOW_AT = room_to_town((WIN_X, ROOM_BACK, WIN_Z + WIN_H / 2))
