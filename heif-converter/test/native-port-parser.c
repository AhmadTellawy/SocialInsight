/* Compile locally only, never copied to the runtime image. This invokes the
 * exact parser used before native health launch, with no networking. */
#define main confinement_entrypoint
#include "../native/confine.c"
#undef main
int main(void) {
  char port[6];validate_port(port);puts(port);return 0;
}
