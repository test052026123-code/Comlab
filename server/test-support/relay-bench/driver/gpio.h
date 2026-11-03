#pragma once
#include "Arduino.h"
typedef int gpio_num_t;
inline int gpio_set_level(gpio_num_t, int value) { FakeBoard::setLevel(value); return 0; }
