typedef Json = Map<String, dynamic>;

abstract interface class Identification {
  String get label;
  String normalize(String input);
}

class StudentIdIdentification implements Identification {
  @override
  String get label => 'Student record ID';
  @override
  String normalize(String input) {
    final id = input.trim().toUpperCase();
    if (!RegExp(r'^[A-Z0-9][A-Z0-9_-]{0,39}$').hasMatch(id)) {
      throw const FormatException(
        'Enter a valid registered student ID (letters, numbers, dash or underscore).',
      );
    }
    return id;
  }
}

abstract interface class LabRepository {
  Future<Json> get(String path);
  Future<Json> post(String path, Json data);
  Future<Json> put(String path, Json data);
  Future<String> exportCsv(String query);
}

abstract interface class DeviceGateway {
  Future<Json> health();
  Future<Json> nodes();
  Future<Json> submit(Json command);
  Future<Json> result(String commandId);
}

abstract interface class PrivateStore {
  Future<String?> read(String key);
  Future<void> write(String key, String? value);
}

bool terminalCommand(String? state) =>
    ['confirmed_on', 'failed', 'rejected'].contains(state);
