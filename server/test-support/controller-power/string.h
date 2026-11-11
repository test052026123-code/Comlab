#pragma once
#include <stddef.h>
extern "C" {
size_t strlen(const char* value);
int strcmp(const char* a, const char* b);
void* memcpy(void* output, const void* input, size_t count);
}
